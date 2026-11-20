// Importa o módulo gRPC nativo para comunicação RPC de alto desempenho
import * as grpc from '@grpc/grpc-js';
// Importa o proto-loader para carregar dinamicamente o contrato Protobuf
import * as protoLoader from '@grpc/proto-loader';
// Importa o módulo nativo 'path' para resolver o caminho do arquivo .proto
import path from 'path';
// Importa a biblioteca 'mqtt' para conectar o controlador ao barramento Mosquitto
import mqtt from 'mqtt';
// Importa as regras clínicas compartilhadas e utilitários determinísticos de consenso
import {
  EstadoSala,
  aplicarConfigurarAtuadores,
  aplicarEventoMqtt,
  aplicarModoCalmaManual,
  clonarEstado,
  compararEstados,
  criarEstadoInicial,
  normalizarEstadoRecebido,
  publicarComandosAtuadores,
  sanitizarEstadoParaGrpc,
} from './regrasClinicas';
// Importa o módulo unificado de persistência, reconexão automática e comparação de catch-up do MongoDB
import {
  criarGerenciadorMongo,
  deveAbsorverEstadoRemoto,
} from './persistenciaMongo';

// Define a porta gRPC exclusiva do Controlador 1 (Nó Líder), permitindo sobrescrita via env em testes isolados
const GRPC_PORT = Number(process.env.GRPC_PORT_1 || 3001);
// Define a porta gRPC do Controlador 2 para comunicação interna de consenso e catch-up
const GRPC_PORT_2 = Number(process.env.GRPC_PORT_2 || 3002);
// Define a porta gRPC do Controlador 3 para votação e replicação de estado
const GRPC_PORT_3 = Number(process.env.GRPC_PORT_3 || 3003);
// Define o identificador único deste Controlador de Processo
const CONTROLLER_ID = 'controlador-1';
// Define o endereço do Broker MQTT Eclipse Mosquitto rodando no Docker
const BROKER_URL = 'mqtt://127.0.0.1:1883';

// Resolve o caminho absoluto do contrato Protobuf único na raiz do projeto
const PROTO_PATH = path.resolve(__dirname, '../proto/diverterapia.proto');

// Carrega as definições do arquivo .proto preservando camelCase e tipos compatíveis
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  // Preserva os nomes exatos dos campos definidos no contrato .proto
  keepCase: true,
  // Converte inteiros de 64 bits para strings no transporte gRPC
  longs: String,
  // Trata enumeradores como strings legíveis
  enums: String,
  // Preenche valores padrão para campos opcionais omitidos
  defaults: true,
  // Habilita suporte para campos alternativos oneof
  oneofs: true,
});

// Extrai o namespace do pacote 'diverterapia' do descritor Protobuf carregado
const diverterapiaProto = (grpc.loadPackageDefinition(packageDefinition) as any).diverterapia;

// Inicializa o estado em memória espelhado com o documento do MongoDB 1
let estadoLocal: EstadoSala = criarEstadoInicial();
// Flag que controla a simulação de falha por parada (Crash Fault) acionada via Dashboard
let falhaParadaSimulada = false;

// Instancia o gerenciador unificado de persistência para a instância MongoDB 1
const persistenciaMongo = criarGerenciadorMongo({
  // Identifica o controlador nos logs e na trilha de inicialização
  controllerId: CONTROLLER_ID,
  // Vincula à instância ordinal 1 do MongoDB
  numeroInstancia: 1,
  // Permite sobrescrever a URI via variável de ambiente MONGO_URI_1
  nomeVarEnv: 'MONGO_URI_1',
  // Define a URI local padrão do Docker Compose para o Controlador 1
  uriPadrao: 'mongodb://127.0.0.1:27017/diverterapia',
  // Fornece acesso ao estado atual em memória para sincronização pós-reconexão
  obterEstadoAtual: () => estadoLocal,
  // Atualiza estadoLocal quando o crash-recovery ou reconexão recuperar dados do banco
  aplicarEstadoRecuperado: (estadoRecuperado) => {
    // Substitui a referência em memória pelo estado recuperado do MongoDB 1
    estadoLocal = estadoRecuperado;
  },
});

// Fila de execução sequencial para evitar race conditions entre mensagens MQTT em rajada e RPCs simultâneas
let filaOperacoes: Promise<void> = Promise.resolve();

// Função auxiliar que serializa operações críticas sobre estadoLocal e consenso em fila FIFO
function enfileirarOperacao<T>(tarefa: () => Promise<T>): Promise<T> {
  // Encadeia a próxima tarefa após a conclusão da anterior, mesmo em caso de erro
  const execucao = filaOperacoes.then(tarefa, tarefa);
  // Atualiza o ponteiro da fila ignorando rejeições para não travar tarefas futuras
  filaOperacoes = execucao.then(
    () => undefined,
    () => undefined
  );
  // Retorna a Promise original da tarefa para o chamador obter o resultado
  return execucao;
}

// Função auxiliar simples para aguardar um pequeno intervalo em milissegundos
function esperarMs(ms: number): Promise<void> {
  // Retorna uma Promise resolvida após o tempo especificado
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Função assíncrona que anexa auditoria e persiste o estado no MongoDB 1 retornando se gravou no banco
async function salvarReplicaMongoDB(tipo: string, descricao: string): Promise<boolean> {
  // Delega ao gerenciador compartilhado retornando true somente se o MongoDB 1 confirmou o upsert
  return persistenciaMongo.anexarHistoricoEPersistir(estadoLocal, tipo, descricao, true);
}

// Define opções de reconexão rápida para os canais gRPC permanentes de votação e efetivação
const GRPC_CONSENSO_OPTIONS: grpc.ClientOptions = {
  // Reduz o backoff inicial de reconexão HTTP/2 de 1000ms para 150ms após boot simultâneo ou queda
  'grpc.initial_reconnect_backoff_ms': 150,
  // Limita o backoff máximo em 1000ms para recuperação ágil de nós reiniciados
  'grpc.max_reconnect_backoff_ms': 1000,
};

// Clientes gRPC internos do Líder para solicitar votos e efetivação nas réplicas 2 e 3
const clientConsenso2 = new diverterapiaProto.ConsensoInterno(
  `127.0.0.1:${GRPC_PORT_2}`,
  grpc.credentials.createInsecure(),
  GRPC_CONSENSO_OPTIONS
);
const clientConsenso3 = new diverterapiaProto.ConsensoInterno(
  `127.0.0.1:${GRPC_PORT_3}`,
  grpc.credentials.createInsecure(),
  GRPC_CONSENSO_OPTIONS
);

// Executa catch-up automático consultando o Controlador 2 caso o Líder tenha reiniciado após failover
async function sincronizarCatchUpComReplica2(): Promise<void> {
  // Encapsula a consulta gRPC em Promise que sempre resolve para não bloquear o boot simultâneo
  await new Promise<void>((resolve) => {
    // Instancia cliente temporário com subchannel pool isolado para não contaminar o backoff de clientConsenso2
    const clientCatchUp = new diverterapiaProto.MiddlewareClinico(
      `127.0.0.1:${GRPC_PORT_2}`,
      grpc.credentials.createInsecure(),
      { 'grpc.use_local_subchannel_pool': 1 }
    );
    // Define prazo curto de 600ms para verificar se a Réplica 2 já está ativa
    const deadline = new Date(Date.now() + 600);
    // Solicita o estado mais recente mantido pela Réplica 2 (que pode ter atuado como Líder Interino)
    clientCatchUp.ObterStatus({}, new grpc.Metadata(), { deadline }, async (err: any, response: any) => {
      // Fecha imediatamente o canal temporário de catch-up liberando recursos locais
      clientCatchUp.close();
      // Se a Réplica 2 estiver offline (ex: boot simultâneo do cluster), segue normalmente
      if (err || !response?.estado?.ultimaAtualizacao) {
        resolve();
        return;
      }
      // Normaliza o estado recebido da Réplica 2 garantindo tipos consistentes
      const estadoReplica2 = normalizarEstadoRecebido(response.estado);
      // Verifica de forma determinística se o estado da Réplica 2 é mais atual que o local
      if (deveAbsorverEstadoRemoto(estadoLocal, estadoReplica2)) {
        // Atualiza o estado em memória com a verdade consolidada durante o failover
        estadoLocal = estadoReplica2;
        // Persiste o estado sincronizado no MongoDB 1 sem duplicar entradas no histórico
        const gravouBanco = await persistenciaMongo.persistirEstado(estadoLocal);
        // Registra no terminal se o estado sincronizado foi salvo no MongoDB 1 ou mantido em RAM
        console.log(
          `🔄 [${CONTROLLER_ID}] Catch-up concluído a partir do Controlador 2 (:${GRPC_PORT_2}) — ${
            gravouBanco ? 'salvo no MongoDB 1!' : 'mantido em RAM (MongoDB 1 offline).'
          }`
        );
      }
      // Conclui a etapa de sincronização de boot
      resolve();
    });
  });
}

// Dispara pedido de voto individual para uma réplica específica via RPC VotarEstado
function pedirVoto(client: any, porta: number, tipoEvento: string, candidato: EstadoSala): Promise<any> {
  // Encapsula o callback gRPC em uma Promise com timeout
  return new Promise((resolve, reject) => {
    // Define prazo máximo de 1000ms considerando eventual janela de sincronização MQTT na réplica
    const deadline = new Date(Date.now() + 1000);
    // Configura waitForReady para aguardar reconexão rápida em vez de falhar em 0ms quando o canal está em backoff
    const metadata = new grpc.Metadata({ waitForReady: true });
    // Invoca o método remoto VotarEstado enviando o estado candidato
    client.VotarEstado(
      {
        liderId: CONTROLLER_ID,
        tipoEvento,
        estadoCandidato: sanitizarEstadoParaGrpc(candidato),
      },
      metadata,
      { deadline },
      (err: any, response: any) => {
        // Rejeita caso a réplica esteja offline ou estoure o deadline
        if (err) {
          reject(err);
        } else {
          // Resolve incluindo a porta de origem para auditoria do Líder
          resolve({ ...response, porta });
        }
      }
    );
  });
}

// Ordena e aguarda a efetivação do estado aprovado nos MongoDBs das réplicas 2 e 3
async function ordenarEfetivacaoNasReplicas(
  tipoEvento: string,
  descricao: string,
  estadoValidado: EstadoSala
): Promise<void> {
  // Monta o payload padronizado com o estado já consolidado (incluindo histórico do Líder)
  const payload = {
    liderId: CONTROLLER_ID,
    tipo: tipoEvento,
    descricao,
    estadoValidado: sanitizarEstadoParaGrpc(estadoValidado),
  };

  // Função auxiliar interna para disparar EfetivarEstado em uma réplica e aguardar confirmação
  const efetivarNo = (client: any, nomeNo: string): Promise<void> =>
    new Promise((resolve) => {
      // Define deadline de 1000ms para a persistência na réplica
      const deadline = new Date(Date.now() + 1000);
      // Configura waitForReady para garantir entrega caso o canal esteja reconectando
      const metadata = new grpc.Metadata({ waitForReady: true });
      // Invoca EfetivarEstado via gRPC
      client.EfetivarEstado(payload, metadata, { deadline }, (err: any) => {
        // Loga aviso se a réplica não respondeu, mas não bloqueia o cluster se ela caiu
        if (err) {
          console.warn(`[${CONTROLLER_ID}] ${nomeNo} não confirmou efetivação:`, err.message);
        }
        // Resolve sempre para não interromper o commit nas demais réplicas disponíveis
        resolve();
      });
    });

  // Executa e aguarda as gravações nas réplicas 2 e 3 em paralelo antes de acionar os atuadores
  await Promise.allSettled([efetivarNo(clientConsenso2, 'Réplica 2'), efetivarNo(clientConsenso3, 'Réplica 3')]);
}

// Função auxiliar que realiza uma rodada completa de consultas VotarEstado às réplicas 2 e 3
async function realizarTurnoVotacao(tipoEvento: string, candidato: EstadoSala) {
  // Inicializa contagem de votos concordantes em 1 (voto próprio do Líder)
  let votosConcordantes = 1;
  // Lista textual com os pareceres individuais da rodada de votação
  const detalhesVotos: string[] = [`Líder (:${GRPC_PORT}): APROVADO`];
  // Sinaliza se a Réplica 2 respondeu com divergência transitória (possível atraso MQTT)
  let replica2DivergiuTransiente = false;

  // Dispara solicitações de voto simultaneamente para as réplicas 2 e 3 usando as portas configuradas
  const resultadosVotos = await Promise.allSettled([
    pedirVoto(clientConsenso2, GRPC_PORT_2, tipoEvento, candidato),
    pedirVoto(clientConsenso3, GRPC_PORT_3, tipoEvento, candidato),
  ]);

  // Avalia o voto recebido da Réplica 2 (porta 3002)
  const res2 = resultadosVotos[0];
  if (res2.status === 'fulfilled') {
    const voto2 = res2.value;
    // Valida aprovação explícita e congruência semântica entre candidato e voto da réplica
    if (voto2.aprova && compararEstados(candidato, voto2.estadoVotado)) {
      votosConcordantes++;
      detalhesVotos.push('Réplica 2 (:3002): APROVADO (Voto Íntegro)');
    } else {
      replica2DivergiuTransiente = true;
      detalhesVotos.push('Réplica 2 (:3002): REJEITADO (Divergência)');
    }
  } else {
    detalhesVotos.push('Réplica 2 (:3002): OFFLINE');
  }

  // Avalia o voto recebido da Réplica 3 (porta 3003)
  const res3 = resultadosVotos[1];
  if (res3.status === 'fulfilled') {
    const voto3 = res3.value;
    // Valida aprovação e integridade dos valores votados (descarta dados bizantinos)
    if (voto3.aprova && compararEstados(candidato, voto3.estadoVotado)) {
      votosConcordantes++;
      detalhesVotos.push('Réplica 3 (:3003): APROVADO (Voto Íntegro)');
    } else {
      detalhesVotos.push(
        `Réplica 3 (:3003): DESCARTADO POR FALHA BIZANTINA (Ruído: ${voto3?.estadoVotado?.ruidoDb}dB, BPM: ${voto3?.estadoVotado?.bpm})`
      );
    }
  } else {
    detalhesVotos.push('Réplica 3 (:3003): OFFLINE');
  }

  // Retorna o resultado consolidado deste turno de votação
  return { votosConcordantes, detalhesVotos, replica2DivergiuTransiente };
}

// Orquestra o consenso completo do Líder ANTES de gravar no MongoDB e acionar atuadores
async function executarQuorumLider(
  tipoEvento: string,
  descricao: string,
  candidato: EstadoSala,
  publicarAtuadores: boolean = false,
  aguardarPropagacaoMqtt: boolean = false
): Promise<boolean> {
  // Loga início da rodada de votação de consenso
  console.log(`🗳️ [${CONTROLLER_ID}] Submetendo estado candidato à votação de Quorum (${tipoEvento})...`);

  // Em eventos MQTT, aguarda breve janela de 40ms para garantir entrega paralela do Mosquitto às réplicas
  if (aguardarPropagacaoMqtt) {
    await esperarMs(40);
  }

  // Executa o primeiro turno de votação nas réplicas 2 e 3
  let resultadoTurno = await realizarTurnoVotacao(tipoEvento, candidato);

  // Caso haja falha de quorum por divergência transitória na Réplica 2 após MQTT, realiza 1 retry curto
  if (
    resultadoTurno.votosConcordantes < 2 &&
    resultadoTurno.replica2DivergiuTransiente &&
    aguardarPropagacaoMqtt
  ) {
    // Aguarda mais 80ms para entrega completa de pacotes na Réplica 2 antes da segunda tentativa
    await esperarMs(80);
    // Executa o turno de retentativa
    resultadoTurno = await realizarTurnoVotacao(tipoEvento, candidato);
  }

  // Extrai contagem final de votos e detalhes para auditoria
  const { votosConcordantes, detalhesVotos } = resultadoTurno;

  // Verifica se o Quorum mínimo de 2 em 3 votos foi alcançado
  if (votosConcordantes >= 2) {
    // Diferencia nos logs quando houve consenso unânime (3/3) ou maioria simples (2/3 com descarte bizantino)
    if (votosConcordantes === 3) {
      console.log(`⚖️ [${CONTROLLER_ID}] CONSENSO UNÂNIME (3/3 votos): [${detalhesVotos.join(' | ')}]`);
    } else {
      console.log(`⚖️ [${CONTROLLER_ID}] QUORUM 2x1 ALCANÇADO (2/3 votos): [${detalhesVotos.join(' | ')}]`);
    }

    // Passo 1 pós-consenso: Atualiza o estado em memória com o candidato aprovado
    estadoLocal = normalizarEstadoRecebido(candidato);

    // Passo 2 pós-consenso: Persiste o estado aprovado no MongoDB 1 do Líder e verifica se gravou em disco
    const persistidoMongo = await salvarReplicaMongoDB(
      tipoEvento,
      `${descricao} [Consenso Quorum ${votosConcordantes}/3 Aprovado]`
    );

    // Passo 3 pós-consenso: Aguarda efetivação síncrona nos MongoDBs 2 e 3 antes de acionar atuadores
    await ordenarEfetivacaoNasReplicas(tipoEvento, descricao, estadoLocal);

    // Passo 4 pós-consenso: Publica comandos físicos aos atuadores MQTT apenas quando aplicável e conectado
    if (publicarAtuadores && mqttClient) {
      publicarComandosAtuadores(mqttClient, estadoLocal, CONTROLLER_ID);
    }

    // Loga o resultado real da persistência no MongoDB 1 sem gerar falso positivo quando offline
    if (persistidoMongo) {
      console.log(`✅ [${CONTROLLER_ID}] Estado validado persistido no MongoDB 1 e replicado nas instâncias 2 e 3.`);
    } else {
      console.warn(`⚠️ [${CONTROLLER_ID}] Estado validado em RAM (MongoDB 1 offline) e replicado nas instâncias 2 e 3.`);
    }
    // Confirma sucesso do consenso e execução
    return true;
  }

  // Caso o Quorum não seja alcançado, descarta o candidato sem alterar banco nem atuadores
  console.warn(`🚨 [${CONTROLLER_ID}] FALHA DE QUORUM (${votosConcordantes}/3 votos). Candidato descartado. [${detalhesVotos.join(' | ')}]`);
  // Sinaliza rejeição ao chamador
  return false;
}

// Classe que implementa o Objeto Distribuído do Controlador Líder da Sala 1
class ControladorProcessoSala1 {
  // Retorna um snapshot seguro do estado em memória evitando sobrescrita fora da fila durante polling
  public async obterStatus() {
    // Clona o estado já sincronizado em memória para evitar race conditions durante gravações concorrentes
    const estadoAtual = clonarEstado(estadoLocal);
    // Devolve envelope completo com status real de conexão do MongoDB 1
    return {
      controlador: CONTROLLER_ID,
      porta: GRPC_PORT,
      armazenamentoId: persistenciaMongo.obterArmazenamentoId(),
      integridade: 'LIDER_HONESTO',
      estado: estadoAtual,
    };
  }

  // Aciona manualmente o protocolo de Regulação Sensorial passando antes pelo Quorum 2x1
  public async ativarModoCalmaManual(origemCliente: string) {
    // Executa dentro da fila sequencial para evitar conflito com eventos MQTT em curso
    return enfileirarOperacao(async () => {
      // Gera o candidato determinístico a partir do estadoLocal atualizado
      const candidato = aplicarModoCalmaManual(estadoLocal, origemCliente);
      // Submete o candidato ao Quorum antes de salvar e acionar atuadores
      const aprovado = await executarQuorumLider(
        'INVOCACAO_METODO',
        `Regulação Sensorial Manual acionada por ${origemCliente}`,
        candidato,
        true,
        false
      );

      // Verifica o status real de conexão ao MongoDB 1 para compor a mensagem fielmente
      const destino = persistenciaMongo.estaConectado()
        ? 'gravado no MongoDB 1'
        : 'mantido em RAM (MongoDB 1 offline)';

      // Retorna o resultado tipado para serialização em SucessoResponse
      return {
        sucesso: aprovado,
        metodoInvocado: 'ativarModoCalmaManual()',
        processadoPor: CONTROLLER_ID,
        porta: GRPC_PORT,
        mensagem: aprovado
          ? `Método validado por Quorum 2x1 e ${destino} pelo Líder ${CONTROLLER_ID}!`
          : `Consenso rejeitado: Quorum 2x1 não foi atingido.`,
        estado: estadoLocal,
        simularFalhaBizantina: false,
      };
    });
  }

  // Configura os 3 atuadores com parâmetros personalizados passando antes pelo Quorum 2x1
  public async configurarAtuadores(
    origemCliente: string,
    parametros: { corLuz?: string; somSpeaker?: string; textoDisplay?: string }
  ) {
    // Executa dentro da fila sequencial para garantir linearidade do estado
    return enfileirarOperacao(async () => {
      // Gera o candidato determinístico a partir do estadoLocal atualizado
      const candidato = aplicarConfigurarAtuadores(estadoLocal, parametros);
      // Submete ao Quorum antes de gravar no banco e publicar aos atuadores
      const aprovado = await executarQuorumLider(
        'INVOCACAO_METODO',
        `Configuração de atuadores acionada por ${origemCliente} via ${CONTROLLER_ID}`,
        candidato,
        true,
        false
      );

      // Verifica o status real de conexão ao MongoDB 1 para informar o destino real
      const destino = persistenciaMongo.estaConectado()
        ? 'persistidos no MongoDB 1'
        : 'mantidos em RAM (MongoDB 1 offline)';

      // Retorna o resultado tipado para serialização em SucessoResponse
      return {
        sucesso: aprovado,
        metodoInvocado: 'configurarAtuadores()',
        processadoPor: CONTROLLER_ID,
        porta: GRPC_PORT,
        mensagem: aprovado
          ? `Atuadores validados por Quorum 2x1 e ${destino} pelo Líder!`
          : `Consenso rejeitado: Quorum não atingido.`,
        estado: estadoLocal,
        simularFalhaBizantina: false,
      };
    });
  }
}

// Instancia o Objeto Distribuído do Controlador Líder
const objetoControlador = new ControladorProcessoSala1();

// Referência ao cliente MQTT inicializado apenas após o recovery do banco e catch-up
let mqttClient: mqtt.MqttClient | null = null;

// Função responsável por conectar ao Broker Mosquitto e registrar assinaturas após boot ordenado
function iniciarMqtt(): void {
  // Cria a conexão MQTT com clientId exclusivo para o Líder
  const client = mqtt.connect(BROKER_URL, {
    // Gera identificador exclusivo de sessão MQTT para o Líder
    clientId: `${CONTROLLER_ID}_${Math.random().toString(16).slice(2, 6)}`,
  });
  // Salva a instância ativa na referência global do módulo
  mqttClient = client;

  // Assina os tópicos de telemetria e recepção assim que conectar no Broker Mosquitto
  client.on('connect', () => {
    // Loga conexão bem-sucedida com o Mosquitto
    console.log(`[${CONTROLLER_ID}] Líder conectado ao Broker MQTT em ${BROKER_URL}`);
    // Lista completa de tópicos monitorados pelo middleware clínico
    const topicosAssinados = [
      'clinica/sala1/ruido',
      'clinica/sala1/bpm',
      'clinica/sala1/presenca',
      'clinica/sala1/porta',
    ];
    // Realiza assinatura com QoS 0
    client.subscribe(topicosAssinados, { qos: 0 }, (err) => {
      if (!err) {
        console.log(`[${CONTROLLER_ID}] Assinaturas MQTT ativas: ${topicosAssinados.join(', ')}`);
      }
    });
  });

  // Processa mensagens MQTT na fila sequencial aplicando Quorum 2x1 antes de gravar no MongoDB
  client.on('message', (topic, message) => {
    // Verifica se o controlador está com simulação de parada (Crash Fault) ativa
    if (falhaParadaSimulada) {
      // Ignora silenciosamente qualquer mensagem enquanto o processo simular falha
      return;
    }
    // Enfileira o processamento para garantir que pacotes consecutivos nunca disputem estadoLocal
    enfileirarOperacao(async () => {
      try {
        // Decodifica o payload JSON recebido do barramento MQTT
        const dados = JSON.parse(message.toString());
        // Aplica a regra determinística sobre o estadoLocal atual gerando um candidato
        const resultado = aplicarEventoMqtt(estadoLocal, topic, dados);
        // Ignora pacotes que não alteram o domínio clínico
        if (!resultado.relevante) {
          return;
        }
        // Submete o estado candidato ao Quorum aguardando breve propagação MQTT às réplicas
        await executarQuorumLider(
          resultado.tipoEvento,
          resultado.descricao,
          resultado.candidato,
          resultado.publicarAtuadores,
          true
        );
      } catch (err) {
        // Loga payloads malformados sem derrubar o controlador
        console.error(`[${CONTROLLER_ID}] Erro ao processar mensagem MQTT:`, err);
      }
    });
  });
}

// Instancia o servidor gRPC puro para atendimento externo e consenso interno na porta 3001
const grpcServer = new grpc.Server();

// Registra os procedimentos remotos do serviço MiddlewareClinico
grpcServer.addService(diverterapiaProto.MiddlewareClinico.service, {
  // Handler RPC ObterStatus
  ObterStatus: async (_call: any, callback: any) => {
    // Interrompe imediatamente se o nó estiver com falha por parada (Crash) simulada
    if (falhaParadaSimulada) {
      // Retorna código UNAVAILABLE simulando a indisponibilidade total do processo
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 1 offline (Simulação de Falha por Parada / Crash).',
      });
      // Encerra a execução do handler
      return;
    }
    try {
      const status = await objetoControlador.obterStatus();
      callback(null, {
        controlador: status.controlador,
        porta: status.porta,
        armazenamentoId: status.armazenamentoId,
        integridade: status.integridade,
        estado: sanitizarEstadoParaGrpc(status.estado),
        falhaParadaSimulada,
      });
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err?.message || 'Erro ao consultar status no Controlador Líder',
      });
    }
  },

  // Handler RPC AtivarModoCalmaManual
  AtivarModoCalmaManual: async (call: any, callback: any) => {
    // Rejeita a requisição se o controlador estiver simulando queda
    if (falhaParadaSimulada) {
      // Devolve UNAVAILABLE para simular nó fora do ar
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 1 offline (Simulação de Falha por Parada / Crash).',
      });
      // Interrompe execução
      return;
    }
    try {
      const origem = call.request?.origem || 'Dashboard Cliente';
      const resultado = await objetoControlador.ativarModoCalmaManual(origem);
      callback(null, {
        sucesso: resultado.sucesso,
        metodoInvocado: resultado.metodoInvocado,
        processadoPor: resultado.processadoPor,
        porta: resultado.porta,
        mensagem: resultado.mensagem,
        estado: sanitizarEstadoParaGrpc(resultado.estado),
        simularFalhaBizantina: resultado.simularFalhaBizantina,
        falhaParadaSimulada,
      });
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err?.message || 'Erro ao ativar modo calma no Controlador Líder',
      });
    }
  },

  // Handler RPC InvocarMetodo
  InvocarMetodo: async (call: any, callback: any) => {
    // Rejeita a chamada se o nó estiver derrubado
    if (falhaParadaSimulada) {
      // Devolve status UNAVAILABLE
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 1 offline (Simulação de Falha por Parada / Crash).',
      });
      // Retorna precocemente
      return;
    }
    try {
      const { metodo, origem, parametros } = call.request;
      const clienteOrigem = origem || 'Dashboard Cliente';
      if (metodo === 'configurarAtuadores') {
        const resultado = await objetoControlador.configurarAtuadores(clienteOrigem, parametros || {});
        callback(null, {
          sucesso: resultado.sucesso,
          metodoInvocado: resultado.metodoInvocado,
          processadoPor: resultado.processadoPor,
          porta: resultado.porta,
          mensagem: resultado.mensagem,
          estado: sanitizarEstadoParaGrpc(resultado.estado),
          simularFalhaBizantina: resultado.simularFalhaBizantina,
          falhaParadaSimulada,
        });
      } else {
        const resultado = await objetoControlador.ativarModoCalmaManual(clienteOrigem);
        callback(null, {
          sucesso: resultado.sucesso,
          metodoInvocado: resultado.metodoInvocado,
          processadoPor: resultado.processadoPor,
          porta: resultado.porta,
          mensagem: resultado.mensagem,
          estado: sanitizarEstadoParaGrpc(resultado.estado),
          simularFalhaBizantina: resultado.simularFalhaBizantina,
          falhaParadaSimulada,
        });
      }
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err?.message || 'Erro ao invocar método no Controlador Líder',
      });
    }
  },

  // Handler RPC ToggleBizantino (Líder permanece sempre íntegro)
  ToggleBizantino: async (_call: any, callback: any) => {
    // Rejeita se o nó estiver offline
    if (falhaParadaSimulada) {
      // Devolve UNAVAILABLE
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 1 offline (Simulação de Falha por Parada / Crash).',
      });
      // Retorna
      return;
    }
    callback(null, {
      sucesso: true,
      metodoInvocado: 'ToggleBizantino()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: 'Controlador 1 é o Líder e opera sempre com integridade garantida.',
      estado: sanitizarEstadoParaGrpc(estadoLocal),
      simularFalhaBizantina: false,
      falhaParadaSimulada,
    });
  },

  // Handler RPC AlternarStatusOperacional (Derrubar ou Reviver o nó simulando Crash e Recovery)
  AlternarStatusOperacional: async (_call: any, callback: any) => {
    // Inverte a flag booleana de simulação de parada
    falhaParadaSimulada = !falhaParadaSimulada;
    // Se o controlador foi revivido, dispara catch-up com o Controlador 2 para recuperar eventos perdidos
    if (!falhaParadaSimulada) {
      // Registra a recuperação no console do servidor
      console.log(`[${CONTROLLER_ID}] 🔄 Controlador 1 revivido! Disparando Catch-up com C2...`);
      // Executa a rotina de catch-up com o Controlador 2
      await sincronizarCatchUpComReplica2();
      // Registra que a sincronização foi concluída e o nó reassumiu
      console.log(`[${CONTROLLER_ID}] ✅ Catch-up concluído com sucesso. Liderança íntegra restabelecida.`);
    } else {
      // Registra a simulação de queda no console do servidor
      console.log(`[${CONTROLLER_ID}] 💀 Controlador 1 derrubado! Simulação de Crash ativada.`);
    }
    // Retorna resposta RPC com o novo status operacional
    callback(null, {
      sucesso: true,
      metodoInvocado: 'AlternarStatusOperacional()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: falhaParadaSimulada
        ? 'Controlador 1 derrubado (Falha de Parada / Crash ativa).'
        : 'Controlador 1 recuperado e sincronizado via Catch-up!',
      estado: sanitizarEstadoParaGrpc(estadoLocal),
      simularFalhaBizantina: false,
      falhaParadaSimulada,
    });
  },
});

// Registra os procedimentos internos do serviço ConsensoInterno no Líder
grpcServer.addService(diverterapiaProto.ConsensoInterno.service, {
  // Retorna o voto próprio do Líder caso consultado
  VotarEstado: async (_call: any, callback: any) => {
    // Se estiver derrubado, não vota
    if (falhaParadaSimulada) {
      // Retorna erro gRPC
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 1 offline (Simulação de Crash).',
      });
      // Encerra
      return;
    }
    callback(null, {
      controlador: CONTROLLER_ID,
      porta: GRPC_PORT,
      aprova: true,
      estadoVotado: sanitizarEstadoParaGrpc(estadoLocal),
      justificativa: 'Voto íntegro do Controlador Líder 1',
    });
  },

  // Efetivação interna caso solicitada
  EfetivarEstado: async (call: any, callback: any) => {
    // Se estiver derrubado, não efetiva
    if (falhaParadaSimulada) {
      // Retorna erro gRPC
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 1 offline (Simulação de Crash).',
      });
      // Encerra
      return;
    }
    try {
      const { estadoValidado } = call.request;
      if (estadoValidado) {
        // Normaliza e atualiza o estado local com o snapshot validado recebido
        estadoLocal = normalizarEstadoRecebido(estadoValidado);
      }
      // Persiste o estado consolidado no MongoDB 1 retornando se a gravação ocorreu no banco
      const gravouBanco = await persistenciaMongo.persistirEstado(estadoLocal);
      callback(null, {
        sucesso: true,
        metodoInvocado: 'EfetivarEstado()',
        processadoPor: CONTROLLER_ID,
        porta: GRPC_PORT,
        mensagem: gravouBanco ? 'Efetivado no MongoDB 1 do Líder' : 'Efetivado em RAM no Líder (MongoDB 1 offline)',
        estado: sanitizarEstadoParaGrpc(estadoLocal),
        simularFalhaBizantina: false,
        falhaParadaSimulada,
      });
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err?.message || 'Erro ao efetivar no Líder' });
    }
  },
});

// Função de inicialização ordenada garantindo recovery do MongoDB e catch-up antes do MQTT e gRPC
async function iniciarServidor(): Promise<void> {
  // Aguarda a conexão inicial com o MongoDB 1, crash-recovery e ativação da reconexão automática
  await persistenciaMongo.inicializar();
  // Realiza catch-up junto ao Controlador 2 caso este Líder tenha reiniciado após failover
  await sincronizarCatchUpComReplica2();
  // Conecta ao Broker Mosquitto somente depois de restaurar o estado completo
  iniciarMqtt();
  // Vincula o servidor gRPC na porta 3001 com credenciais inseguras locais
  grpcServer.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error(`[${CONTROLLER_ID}] Erro ao iniciar servidor gRPC:`, err);
        return;
      }
      console.log(`=====================================================`);
      console.log(`[MIDDLEWARE gRPC] ${CONTROLLER_ID} (LÍDER DE CONSENSO) ativo na porta ${port}`);
      // Exibe o status real de conexão com o MongoDB 1 ou Fallback RAM
      console.log(`   -> Armazenamento: ${persistenciaMongo.obterArmazenamentoId()}`);
      console.log(`   -> Mecanismo: Quorum 2x1 com Validação Pré-Persistência`);
      console.log(`=====================================================`);
    }
  );
}

// Dispara a inicialização ordenada do Controlador 1
iniciarServidor();
