// Importa o módulo gRPC nativo para expor procedimentos remotos
import * as grpc from '@grpc/grpc-js';
// Importa o proto-loader para carregar o contrato Protobuf compartilhado
import * as protoLoader from '@grpc/proto-loader';
// Importa o módulo nativo 'path' para localizar o arquivo .proto
import path from 'path';
// Importa a biblioteca 'mqtt' para receber telemetria e acionar atuadores em contingência extrema
import mqtt from 'mqtt';
// Importa as regras clínicas compartilhadas e utilitários determinísticos de consenso
import {
  EstadoSala,
  aplicarConfigurarAtuadores,
  aplicarEventoMqtt,
  aplicarModoCalmaManual,
  clonarEstado,
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

// Define a porta gRPC do Controlador 1 (Líder) para catch-up configurável via env
const GRPC_PORT_1 = Number(process.env.GRPC_PORT_1 || 3001);
// Define a porta gRPC do Controlador 2 (Réplica Honesta) para fallback de catch-up configurável via env
const GRPC_PORT_2 = Number(process.env.GRPC_PORT_2 || 3002);
// Define a porta gRPC exclusiva do Controlador 3 (Réplica Bizantina Toggleável)
const GRPC_PORT = Number(process.env.GRPC_PORT_3 || 3003);
// Define o identificador único deste Controlador de Processo
const CONTROLLER_ID = 'controlador-3';
// Define a URL do Broker MQTT Eclipse Mosquitto
const BROKER_URL = 'mqtt://127.0.0.1:1883';

// Flag que controla a simulação de Falha Bizantina (inicia ativa por padrão para demonstração)
let simularFalhaBizantina = true;
// Flag que controla a simulação de falha por parada (Crash Fault) acionada via Dashboard
let falhaParadaSimulada = false;
// Flag que rastreia se algum dos líderes superiores (Controlador 1 ou 2) está online
let lideresSuperioresOnline = true;

// Fila sequencial para serializar operações do Controlador 3 quando atuando como Líder Interino
let filaOperacoes: Promise<void> = Promise.resolve();

// Função auxiliar que encadeia tarefas críticas em ordem FIFO
function enfileirarOperacao<T>(tarefa: () => Promise<T>): Promise<T> {
  // Encadeia a próxima tarefa após a conclusão da anterior
  const execucao = filaOperacoes.then(tarefa, tarefa);
  // Atualiza o ponteiro da fila ignorando rejeições para não travar a fila
  filaOperacoes = execucao.then(
    () => undefined,
    () => undefined
  );
  // Retorna a Promise original da tarefa
  return execucao;
}

// Resolve o caminho absoluto do contrato Protobuf único na raiz do projeto
const PROTO_PATH = path.resolve(__dirname, '../proto/diverterapia.proto');

// Carrega as definições do arquivo .proto com opções tipadas
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  // Mantém nomes em camelCase conforme o .proto
  keepCase: true,
  // Converte int64 para strings no transporte gRPC
  longs: String,
  // Trata enums como strings
  enums: String,
  // Garante preenchimento de defaults
  defaults: true,
  // Habilita suporte a campos oneof
  oneofs: true,
});

// Extrai o pacote 'diverterapia' do descritor Protobuf
const diverterapiaProto = (grpc.loadPackageDefinition(packageDefinition) as any).diverterapia;

// Armazena o estado oficialmente validado pelo Quorum e persistido no MongoDB 3
let estadoConfirmado: EstadoSala = criarEstadoInicial();
// Armazena o estado calculado independentemente via MQTT para emissão de voto quando em Modo Honesto
let estadoTelemetria: EstadoSala = criarEstadoInicial();

// Instancia o gerenciador unificado de persistência para a instância MongoDB 3
const persistenciaMongo = criarGerenciadorMongo({
  // Identifica o controlador nos logs e na trilha de inicialização
  controllerId: CONTROLLER_ID,
  // Vincula à instância ordinal 3 do MongoDB
  numeroInstancia: 3,
  // Permite sobrescrever a URI via variável de ambiente MONGO_URI_3
  nomeVarEnv: 'MONGO_URI_3',
  // Define a URI local padrão do Docker Compose para o Controlador 3
  uriPadrao: 'mongodb://127.0.0.1:27019/diverterapia',
  // Fornece acesso ao estado confirmado em memória para sincronização pós-reconexão
  obterEstadoAtual: () => estadoConfirmado,
  // Atualiza estadoConfirmado e estadoTelemetria quando o crash-recovery ou reconexão recuperar dados do banco
  aplicarEstadoRecuperado: (estadoRecuperado) => {
    // Atualiza o estado confirmado com o snapshot recuperado do MongoDB 3
    estadoConfirmado = estadoRecuperado;
    // Mantém o buffer de telemetria espelhado para votação honesta coerente
    estadoTelemetria = clonarEstado(estadoRecuperado);
  },
});

// Função auxiliar para aguardar milissegundos em sincronizações assíncronas
function esperarMs(ms: number): Promise<void> {
  // Retorna uma Promise resolvida após o timeout
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Função auxiliar que gera o objeto com valores adulterados para simulação de Falha Bizantina
function gerarEstadoAdulterado(base: EstadoSala): EstadoSala {
  return {
    ...clonarEstado(base),
    // Ruído impossível para tentar forçar alarme falso
    ruidoDb: 999,
    // Batimento cardíaco impossível
    bpm: 250,
    // Inverte propositalmente o estado de presença
    presenca: !base.presenca,
    // Assinatura explícita de dado adulterado bizantino
    tagId: 'DADO_ADULTERADO_BIZANTINO',
    // Trilha falsa
    musicaFavorita: 'sirene-descalibrada',
    // Cor falsa
    corFavorita: 'vermelho-bizantino',
    // Estado falso de iluminação
    iluminacao: 'Vermelho / Alerta Falso',
    // Estado falso de áudio
    smartSpeaker: 'Sirene Descalibrada',
    // Mensagem falsa na porta
    displayPorta: '> ERRO BIZANTINO / INVASÃO DETECTADA',
    // Inverte flag do modo calma
    modoCalmaAtivo: !base.modoCalmaAtivo,
  };
}

// Persiste estadoConfirmado no MongoDB 3 adicionando registro histórico somente se originado localmente
async function salvarReplicaMongoDB(
  tipo: string,
  descricao: string,
  adicionarHistorico: boolean = false
): Promise<boolean> {
  // Delega ao gerenciador compartilhado retornando true apenas quando gravou no banco
  return persistenciaMongo.anexarHistoricoEPersistir(estadoConfirmado, tipo, descricao, adicionarHistorico);
}

// Consulta o status de um nó íntegro (C1 ou C2) usando canal isolado apenas durante o boot do Controlador 3
function consultarStatusNoParaCatchUp(porta: number): Promise<any | null> {
  // Retorna sempre uma Promise resolvida com os dados ou null em caso de falha/timeout
  return new Promise((resolve) => {
    // Instancia cliente temporário com subchannel pool local evitando canais ociosos pós-boot
    const client = new diverterapiaProto.MiddlewareClinico(
      `127.0.0.1:${porta}`,
      grpc.credentials.createInsecure(),
      { 'grpc.use_local_subchannel_pool': 1 }
    );
    // Define deadline curto de 600ms para não atrasar a inicialização
    const deadline = new Date(Date.now() + 600);
    // Invoca ObterStatus via gRPC no nó consultado
    client.ObterStatus({}, new grpc.Metadata(), { deadline }, (err: any, response: any) => {
      // Encerra o cliente temporário liberando os recursos do canal isolado
      client.close();
      // Descarta resposta caso haja erro, integridade bizantina ou ausência de estado
      if (err || response?.integridade === 'FALHA_BIZANTINA' || !response?.estado?.ultimaAtualizacao) {
        resolve(null);
        return;
      }
      // Retorna a resposta válida obtida
      resolve(response);
    });
  });
}

// Executa catch-up automático no boot consultando o Controlador 1 ou fallback no Controlador 2
async function sincronizarCatchUpComLider(): Promise<void> {
  // Tenta obter o estado oficial primeiramente no Líder 1
  let origemNome = `Controlador 1 (:${GRPC_PORT_1})`;
  let resposta = await consultarStatusNoParaCatchUp(GRPC_PORT_1);

  // Se o Líder 1 estiver offline, faz fallback consultando o Controlador 2
  if (!resposta) {
    origemNome = `Controlador 2 (:${GRPC_PORT_2})`;
    resposta = await consultarStatusNoParaCatchUp(GRPC_PORT_2);
  }

  // Se nenhum nó íntegro respondeu no boot simultâneo, encerra normalmente
  if (!resposta?.estado) {
    return;
  }

  // Normaliza o estado remoto recebido garantindo tipos compatíveis
  const estadoOrigem = normalizarEstadoRecebido(resposta.estado);
  // Verifica se o estado remoto é mais recente ou possui eventos clínicos ausentes localmente
  if (deveAbsorverEstadoRemoto(estadoConfirmado, estadoOrigem)) {
    // Atualiza o estado confirmado local com o estado oficial do cluster
    estadoConfirmado = estadoOrigem;
    // Atualiza também o buffer de telemetria para manter congruência nos votos
    estadoTelemetria = clonarEstado(estadoOrigem);
    // Persiste o estado sincronizado no MongoDB 3 sem duplicar registros no histórico
    const gravouBanco = await persistenciaMongo.persistirEstado(estadoConfirmado);
    // Registra o catch-up no console informando a origem e se gravou em disco ou RAM
    console.log(
      `🔄 [${CONTROLLER_ID}] Catch-up concluído a partir de ${origemNome} — ${
        gravouBanco ? 'salvo no MongoDB 3!' : 'mantido em RAM (MongoDB 3 offline).'
      }`
    );
  }
}

// Define opções de reconexão rápida para os clientes gRPC de heartbeat e monitoramento
const GRPC_INTERNO_OPTIONS: grpc.ClientOptions = {
  // Reduz o backoff inicial de reconexão HTTP/2 de 1000ms para 150ms
  'grpc.initial_reconnect_backoff_ms': 150,
  // Limita o backoff máximo em 1000ms para agilidade na detecção de falhas
  'grpc.max_reconnect_backoff_ms': 1000,
};

// Clientes gRPC para monitorar a disponibilidade de C1 e C2
const clientLider1 = new diverterapiaProto.MiddlewareClinico(
  `127.0.0.1:${GRPC_PORT_1}`,
  grpc.credentials.createInsecure(),
  GRPC_INTERNO_OPTIONS
);
const clientLider2 = new diverterapiaProto.MiddlewareClinico(
  `127.0.0.1:${GRPC_PORT_2}`,
  grpc.credentials.createInsecure(),
  GRPC_INTERNO_OPTIONS
);

// Inicia o heartbeat periódico de 1500ms para monitorar C1 e C2 e assumir liderança se ambos caírem
function iniciarMonitoramentoLideres(): void {
  // Executa checagem periódica a cada 1500ms
  setInterval(() => {
    // Se o próprio Controlador 3 estiver simulando parada, não monitora nem assume liderança
    if (falhaParadaSimulada) {
      // Retorna precocemente
      return;
    }

    // Prazo de resposta de 600ms para o nó 1
    const deadline1 = new Date(Date.now() + 600);
    // Consulta o Controlador 1
    clientLider1.ObterStatus({}, new grpc.Metadata(), { deadline: deadline1 }, (err1: any) => {
      // Se C1 respondeu com sucesso, C1 é o líder primário ativo
      if (!err1) {
        // Se C3 estava atuando como líder, cede a liderança de volta
        if (!lideresSuperioresOnline) {
          // Marca que os líderes superiores estão de volta
          lideresSuperioresOnline = true;
          // Loga a transição de volta ao modo réplica
          console.log(`🔄 [${CONTROLLER_ID}] Controlador 1 online! Retornando ao papel de réplica.`);
        }
        // Encerra a verificação desta iteração
        return;
      }

      // Se C1 está offline, consulta o Controlador 2 (segunda linha de liderança)
      const deadline2 = new Date(Date.now() + 600);
      clientLider2.ObterStatus({}, new grpc.Metadata(), { deadline: deadline2 }, (err2: any) => {
        // Se C2 respondeu com sucesso, C2 é o líder interino
        if (!err2) {
          // Se C3 estava como líder interino, cede a liderança para C2
          if (!lideresSuperioresOnline) {
            // Marca que C2 está no comando
            lideresSuperioresOnline = true;
            // Loga a cessão de liderança
            console.log(`🔄 [${CONTROLLER_ID}] Controlador 2 online! C2 assumiu a liderança interina.`);
          }
          // Encerra
          return;
        }

        // Se TANTO C1 QUANTO C2 ESTIVEREM OFFLINE:
        // Se C3 estiver em modo honesto (sem erro bizantino), assume como Líder Interino!
        if (!simularFalhaBizantina) {
          // Promove C3 a líder caso ainda não tenha assumido
          if (lideresSuperioresOnline) {
            // Marca que C3 assumiu a liderança
            lideresSuperioresOnline = false;
            // Loga a promoção de C3
            console.log(`👑 [${CONTROLLER_ID}] C1 e C2 offline! Controlador 3 em modo honesto assumindo liderança interina (Failover de 2º Nível).`);
          }
        } else {
          // Se estiver em modo bizantino, não assume a liderança oficial
          if (!lideresSuperioresOnline) {
            // Mantém flag de líder inativo
            lideresSuperioresOnline = true;
          }
        }
      });
    });
  }, 1500);
}

// Executa eventos clínicos como Líder Interino quando C1 e C2 estão offline e C3 opera em modo honesto
async function executarComoLiderInterino(
  tipoEvento: string,
  descricao: string,
  candidato: EstadoSala,
  publicarAtuadores: boolean
): Promise<boolean> {
  // Registra no console a ação do Líder Interino C3
  console.log(`👑 [${CONTROLLER_ID} - LÍDER INTERINO] ${descricao} | Executando em contingência máxima (C1 e C2 offline).`);

  // Atualiza os estados locais confirmados
  estadoConfirmado = normalizarEstadoRecebido(candidato);
  // Atualiza o estado independente de telemetria
  estadoTelemetria = clonarEstado(estadoConfirmado);

  // Persiste no MongoDB 3 marcando que foi efetivado pelo Líder Interino C3
  const persistidoMongo = await salvarReplicaMongoDB(
    tipoEvento,
    `${descricao} [Efetivado por Líder Interino C3]`,
    true
  );

  // Publica comandos aos atuadores via Mosquitto
  if (publicarAtuadores && mqttClient) {
    // Despacha as ordens aos atuadores físicos
    publicarComandosAtuadores(mqttClient, estadoConfirmado, CONTROLLER_ID);
  }

  // Alerta caso o MongoDB 3 esteja offline
  if (!persistidoMongo) {
    // Exibe aviso de persistência em RAM
    console.warn(`⚠️ [${CONTROLLER_ID} - LÍDER INTERINO] MongoDB 3 offline — mantido em RAM.`);
  }

  // Retorna sucesso
  return true;
}

// Classe que implementa o Objeto Distribuído da Réplica 3
class ControladorProcessoSala3 {
  // Retorna um snapshot seguro do estado em memória evitando sobrescrita fora da fila durante polling
  public async obterStatus() {
    // Clona o estado confirmado em memória sem sobrescrevê-lo durante leituras concorrentes
    const estadoReal = clonarEstado(estadoConfirmado);
    // Adultera apenas a cópia retornada se a simulação bizantina estiver ligada
    const estadoRetornado = simularFalhaBizantina ? gerarEstadoAdulterado(estadoReal) : estadoReal;

    // Determina a integridade: se for bizantino, declara FALHA_BIZANTINA; se honesto e líderes caídos, LIDER_INTERINO; senão HONESTO
    const integridade = simularFalhaBizantina
      ? 'FALHA_BIZANTINA'
      : !lideresSuperioresOnline
      ? 'LIDER_INTERINO'
      : 'HONESTO';

    return {
      controlador: CONTROLLER_ID,
      porta: GRPC_PORT,
      armazenamentoId: persistenciaMongo.obterArmazenamentoId(),
      integridade,
      estado: estadoRetornado,
    };
  }

  // Ativa modo calma caso C1 e C2 estejam offline (contingência extrema)
  public async ativarModoCalmaManual(origemCliente: string) {
    // Bloqueia mutação direta caso este nó esteja comprometido pela falha bizantina
    if (simularFalhaBizantina) {
      return {
        sucesso: false,
        metodoInvocado: 'ativarModoCalmaManual()',
        processadoPor: CONTROLLER_ID,
        porta: GRPC_PORT,
        mensagem: 'Nó 3 está em modo FALHA_BIZANTINA e não pode executar comandos confiáveis.',
        estado: estadoConfirmado,
        simularFalhaBizantina: true,
      };
    }

    // Se chamado diretamente pelo gateway e C1/C2 não responderam, assume liderança
    if (lideresSuperioresOnline) {
      // Ativa liderança interina
      lideresSuperioresOnline = false;
      // Loga assunção do comando
      console.log(`👑 [${CONTROLLER_ID}] C1 e C2 offline! Assumindo liderança interina em modo honesto (Failover C3).`);
    }

    // Enfileira a operação sequencialmente
    return enfileirarOperacao(async () => {
      // Aplica regra de modo calma
      const candidato = aplicarModoCalmaManual(estadoConfirmado, origemCliente);
      // Executa como líder interino
      await executarComoLiderInterino(
        'INVOCACAO_METODO',
        `Modo Calma Manual via Failover C3 (${origemCliente})`,
        candidato,
        true
      );
      // Avalia onde gravou
      const destino = persistenciaMongo.estaConectado()
        ? 'persistido no MongoDB 3'
        : 'mantido em RAM (MongoDB 3 offline)';
      // Retorna resultado tipado
      return {
        sucesso: true,
        metodoInvocado: 'ativarModoCalmaManual()',
        processadoPor: CONTROLLER_ID,
        porta: GRPC_PORT,
        mensagem: `Método executado em Failover (Líder Interino C3) e ${destino}!`,
        estado: estadoConfirmado,
        simularFalhaBizantina: false,
      };
    });
  }

  // Configura atuadores caso C1 e C2 estejam offline (contingência extrema)
  public async configurarAtuadores(
    origemCliente: string,
    parametros: { corLuz?: string; somSpeaker?: string; textoDisplay?: string }
  ) {
    // Recusa caso esteja operando com falha bizantina
    if (simularFalhaBizantina) {
      return {
        sucesso: false,
        metodoInvocado: 'configurarAtuadores()',
        processadoPor: CONTROLLER_ID,
        porta: GRPC_PORT,
        mensagem: 'Nó 3 está em modo FALHA_BIZANTINA e recusou alteração insegura.',
        estado: estadoConfirmado,
        simularFalhaBizantina: true,
      };
    }

    // Se chamado diretamente pelo gateway e C1/C2 não responderam, assume liderança
    if (lideresSuperioresOnline) {
      // Ativa liderança interina
      lideresSuperioresOnline = false;
      // Loga assunção do comando
      console.log(`👑 [${CONTROLLER_ID}] C1 e C2 offline! Assumindo liderança interina em modo honesto (Failover C3).`);
    }

    // Enfileira a operação sequencialmente
    return enfileirarOperacao(async () => {
      // Aplica configuração de atuadores
      const candidato = aplicarConfigurarAtuadores(estadoConfirmado, parametros);
      // Executa como líder interino
      await executarComoLiderInterino(
        'INVOCACAO_METODO',
        `Configuração de atuadores via Failover C3 (${origemCliente})`,
        candidato,
        true
      );
      // Avalia onde gravou
      const destino = persistenciaMongo.estaConectado()
        ? 'persistidos no MongoDB 3'
        : 'mantidos em RAM (MongoDB 3 offline)';
      // Retorna resultado tipado
      return {
        sucesso: true,
        metodoInvocado: 'configurarAtuadores()',
        processadoPor: CONTROLLER_ID,
        porta: GRPC_PORT,
        mensagem: `Atuadores configurados em Failover (Líder Interino C3) e ${destino}!`,
        estado: estadoConfirmado,
        simularFalhaBizantina: false,
      };
    });
  }
}

// Instancia o objeto distribuído da Réplica 3
const objetoControlador = new ControladorProcessoSala3();

// Referência ao cliente MQTT inicializado apenas após o recovery do MongoDB 3
let mqttClient: mqtt.MqttClient | null = null;

// Conecta ao Broker MQTT Eclipse Mosquitto para calcular votos honestos após o boot ordenado
function iniciarMqtt(): void {
  // Inicializa o cliente MQTT atribuindo um identificador exclusivo para o Controlador 3
  const client = mqtt.connect(BROKER_URL, {
    // Identificador exclusivo da sessão MQTT do Controlador 3
    clientId: `${CONTROLLER_ID}_${Math.random().toString(16).slice(2, 6)}`,
  });
  // Armazena a instância conectada no escopo do módulo
  mqttClient = client;

  // Assina os mesmos tópicos de telemetria e recepção que os controladores 1 e 2
  client.on('connect', () => {
    console.log(`[${CONTROLLER_ID}] Conectado ao Broker MQTT em ${BROKER_URL}`);
    const topicosAssinados = [
      'clinica/sala1/ruido',
      'clinica/sala1/bpm',
      'clinica/sala1/presenca',
      'clinica/sala1/porta',
    ];
    client.subscribe(topicosAssinados, { qos: 0 });
  });

  // Processa as mensagens MQTT em estadoTelemetria aplicando exatamente as mesmas regras clínicas determinísticas
  client.on('message', (topic, message) => {
    // Interrompe processamento se o nó estiver com falha por parada simulada
    if (falhaParadaSimulada) {
      // Ignora mensagem MQTT simulando processo offline
      return;
    }
    try {
      // Decodifica o payload JSON
      const dados = JSON.parse(message.toString());
      // Aplica a regra determinística na telemetria
      const resultado = aplicarEventoMqtt(estadoTelemetria, topic, dados);
      // Se relevante, atualiza buffer
      if (resultado.relevante) {
        estadoTelemetria = resultado.candidato;
      }

      // Caso C1 e C2 estejam offline e C3 opere em modo honesto, atua como Líder Interino!
      if (!lideresSuperioresOnline && !simularFalhaBizantina) {
        // Enfileira a operação para garantir ordem sequencial
        enfileirarOperacao(async () => {
          // Checa novamente dentro da fila se a liderança ainda cabe a C3
          if (lideresSuperioresOnline || simularFalhaBizantina) return;
          // Aplica o evento sobre o estado confirmado
          const resInterino = aplicarEventoMqtt(estadoConfirmado, topic, dados);
          // Se relevante clinicamente, efetiva e publica
          if (resInterino.relevante) {
            // Executa como líder interino
            await executarComoLiderInterino(
              resInterino.tipoEvento,
              resInterino.descricao,
              resInterino.candidato,
              resInterino.publicarAtuadores
            );
          }
        });
      }
    } catch {
      // Ignora mensagens malformadas silenciosamente
    }
  });
}

// Instancia o servidor gRPC puro na porta 3003
const grpcServer = new grpc.Server();

// Registra os métodos do serviço externo MiddlewareClinico
grpcServer.addService(diverterapiaProto.MiddlewareClinico.service, {
  // Handler RPC ObterStatus
  ObterStatus: async (_call: any, callback: any) => {
    // Interrompe imediatamente se o nó estiver com falha por parada simulada
    if (falhaParadaSimulada) {
      // Retorna código UNAVAILABLE simulando processo inativo
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 3 offline (Simulação de Falha por Parada / Crash).',
      });
      // Retorna
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
      callback({ code: grpc.status.INTERNAL, message: err?.message || 'Erro' });
    }
  },

  // Handler RPC AtivarModoCalmaManual
  AtivarModoCalmaManual: async (call: any, callback: any) => {
    // Rejeita chamada se o nó estiver derrubado
    if (falhaParadaSimulada) {
      // Retorna UNAVAILABLE
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 3 offline (Simulação de Falha por Parada / Crash).',
      });
      // Retorna
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
      callback({ code: grpc.status.INTERNAL, message: err?.message });
    }
  },

  // Handler RPC InvocarMetodo
  InvocarMetodo: async (call: any, callback: any) => {
    // Rejeita se o nó estiver derrubado
    if (falhaParadaSimulada) {
      // Retorna UNAVAILABLE
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 3 offline (Simulação de Falha por Parada / Crash).',
      });
      // Retorna
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
      callback({ code: grpc.status.INTERNAL, message: err?.message });
    }
  },

  // Alterna a flag de simulação de falha bizantina e retorna seu novo estado no campo dedicado
  ToggleBizantino: async (_call: any, callback: any) => {
    // Rejeita se o nó estiver derrubado
    if (falhaParadaSimulada) {
      // Retorna UNAVAILABLE
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 3 offline (Simulação de Falha por Parada / Crash).',
      });
      // Retorna
      return;
    }
    simularFalhaBizantina = !simularFalhaBizantina;
    console.log(`⚠️ [${CONTROLLER_ID}] Modo Falha Bizantina alterado via gRPC para: ${simularFalhaBizantina ? 'ATIVO' : 'INATIVO'}`);
    // Se o modo bizantino foi desligado e os líderes C1 e C2 estiverem caídos, C3 assume imediatamente
    if (!simularFalhaBizantina && !lideresSuperioresOnline) {
      // Notifica no terminal a assunção imediata
      console.log(`👑 [${CONTROLLER_ID}] Modo honesto restaurado com C1 e C2 offline! Controlador 3 assumindo como Líder Interino.`);
    }
    callback(null, {
      sucesso: true,
      metodoInvocado: 'ToggleBizantino()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: `Simulação de Falha Bizantina alterada para: ${simularFalhaBizantina ? 'ATIVO' : 'INATIVO'}`,
      estado: sanitizarEstadoParaGrpc(estadoConfirmado),
      simularFalhaBizantina,
      falhaParadaSimulada,
    });
  },

  // Handler RPC AlternarStatusOperacional (Derrubar ou Reviver o Controlador 3)
  AlternarStatusOperacional: async (_call: any, callback: any) => {
    // Inverte a flag de simulação de parada
    falhaParadaSimulada = !falhaParadaSimulada;
    // Se o nó foi revivido, dispara catch-up para sincronizar dados perdidos
    if (!falhaParadaSimulada) {
      // Loga no console
      console.log(`[${CONTROLLER_ID}] 🔄 Controlador 3 revivido! Sincronizando Catch-up...`);
      // Executa o catch-up
      await sincronizarCatchUpComLider();
      // Loga conclusão
      console.log(`[${CONTROLLER_ID}] ✅ Sincronização Catch-up concluída com sucesso.`);
    } else {
      // Loga queda no console
      console.log(`[${CONTROLLER_ID}] 💀 Controlador 3 derrubado! Simulação de Crash ativada.`);
    }
    // Retorna resposta RPC com o novo status
    callback(null, {
      sucesso: true,
      metodoInvocado: 'AlternarStatusOperacional()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: falhaParadaSimulada
        ? 'Controlador 3 derrubado (Falha de Parada / Crash ativa).'
        : 'Controlador 3 recuperado com sucesso!',
      estado: sanitizarEstadoParaGrpc(estadoConfirmado),
      simularFalhaBizantina,
      falhaParadaSimulada,
    });
  },
});

// Registra os métodos do serviço interno ConsensoInterno
grpcServer.addService(diverterapiaProto.ConsensoInterno.service, {
  // Handler RPC VotarEstado: adultera se flag ativa ou vota honestamente (inclusive INVOCACAO_METODO) se inativa
  VotarEstado: async (call: any, callback: any) => {
    // Se estiver derrubado, não participa de votações
    if (falhaParadaSimulada) {
      // Retorna erro gRPC
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 3 offline (Simulação de Crash).',
      });
      // Retorna
      return;
    }
    const { tipoEvento, estadoCandidato } = call.request;

    // Quando a simulação bizantina está ativa, envia voto deliberadamente corrompido
    if (simularFalhaBizantina) {
      const estadoAdulterado = gerarEstadoAdulterado(estadoTelemetria);
      console.log(`⚠️ [${CONTROLLER_ID}] Voto BIZANTINO ADULTERADO emitido ao Líder (Ruído: 999dB, BPM: 250, Evento: ${tipoEvento})`);

      callback(null, {
        controlador: CONTROLLER_ID,
        porta: GRPC_PORT,
        aprova: false,
        estadoVotado: sanitizarEstadoParaGrpc(estadoAdulterado),
        justificativa: 'FALHA_BIZANTINA: Dados adulterados deliberadamente para validar o Quorum 2x1 do Líder',
      });
      return;
    }

    // Em modo honesto, valida INVOCACAO_METODO sem mutar estadoConfirmado antes de EfetivarEstado
    if (tipoEvento === 'INVOCACAO_METODO' && estadoCandidato) {
      const tag = String(estadoCandidato.tagId || '');
      const ruido = Number(estadoCandidato.ruidoDb || 0);
      const bpm = Number(estadoCandidato.bpm || 0);
      const candidatoValido =
        ruido >= 0 &&
        ruido <= 150 &&
        bpm >= 0 &&
        bpm <= 220 &&
        !tag.includes('BIZANTINO') &&
        !tag.includes('HACKED');

      if (!candidatoValido) {
        callback(null, {
          controlador: CONTROLLER_ID,
          porta: GRPC_PORT,
          aprova: false,
          estadoVotado: sanitizarEstadoParaGrpc(estadoConfirmado),
          justificativa: 'Voto REJEITADO pela Réplica 3 em modo honesto.',
        });
        return;
      }

      const estadoValidadoTemp = normalizarEstadoRecebido(estadoCandidato);
      console.log(`✅ [${CONTROLLER_ID}] Voto ÍNTEGRO emitido ao Líder (Modo Honesto, Evento: ${tipoEvento})`);
      callback(null, {
        controlador: CONTROLLER_ID,
        porta: GRPC_PORT,
        aprova: true,
        estadoVotado: sanitizarEstadoParaGrpc(estadoValidadoTemp),
        justificativa: `Voto íntegro e honesto emitido pela Réplica 3 (Porta ${GRPC_PORT})`,
      });
      return;
    }

    // Em modo honesto para eventos MQTT, aguarda até 160ms para sincronizar entrega do Mosquitto
    const tsAlvo = estadoCandidato?.ultimaAtualizacao;
    if (tsAlvo) {
      let tentativas = 0;
      while (estadoTelemetria.ultimaAtualizacao !== tsAlvo && tentativas < 8) {
        await esperarMs(20);
        tentativas++;
      }
    }

    // Emite voto honesto fundamentado pelo estadoTelemetria calculado localmente
    console.log(`✅ [${CONTROLLER_ID}] Voto ÍNTEGRO emitido ao Líder (Modo Honesto, Evento: ${tipoEvento})`);
    callback(null, {
      controlador: CONTROLLER_ID,
      porta: GRPC_PORT,
      aprova: true,
      estadoVotado: sanitizarEstadoParaGrpc(estadoTelemetria),
      justificativa: `Voto íntegro e honesto emitido pela Réplica 3 (Porta ${GRPC_PORT})`,
    });
  },

  // Handler RPC EfetivarEstado: sempre grava o estado íntegro aprovado pelo Quorum no MongoDB 3 (corrige o nó 3)
  EfetivarEstado: async (call: any, callback: any) => {
    // Rejeita efetivação se o nó estiver derrubado
    if (falhaParadaSimulada) {
      // Retorna erro gRPC
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 3 offline (Simulação de Crash).',
      });
      // Retorna
      return;
    }
    try {
      const { tipo, descricao, estadoValidado } = call.request;
      if (estadoValidado) {
        // Sobrescreve os buffers locais com o estado aprovado garantindo sincronismo do MongoDB 3
        estadoConfirmado = normalizarEstadoRecebido(estadoValidado);
        estadoTelemetria = clonarEstado(estadoConfirmado);
      }
      // Persiste preservando exatamente o histórico consolidado enviado pelo Líder
      const gravouBanco = await salvarReplicaMongoDB(tipo || 'CONSENSO', `${descricao} [Efetivado via Líder]`, false);
      callback(null, {
        sucesso: true,
        metodoInvocado: 'EfetivarEstado()',
        processadoPor: CONTROLLER_ID,
        porta: GRPC_PORT,
        mensagem: gravouBanco
          ? 'Estado validado pelo Quorum persistido no MongoDB 3!'
          : 'Estado validado pelo Quorum mantido em RAM (MongoDB 3 offline)!',
        estado: sanitizarEstadoParaGrpc(estadoConfirmado),
        simularFalhaBizantina,
      });
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err?.message || 'Erro ao efetivar' });
    }
  },
});

// Função de inicialização ordenada garantindo recovery do MongoDB 3 e catch-up antes do MQTT e gRPC
async function iniciarServidor(): Promise<void> {
  // Conecta, realiza crash-recovery no MongoDB 3 e ativa a reconexão automática
  await persistenciaMongo.inicializar();
  // Consulta o Líder 1 (ou Controlador 2) para absorver eventos perdidos caso o Nó 3 tenha reiniciado
  await sincronizarCatchUpComLider();
  // Conecta ao Broker Mosquitto somente após concluir o crash-recovery e catch-up
  iniciarMqtt();
  // Inicia o monitoramento periódico de heartbeat dos líderes superiores C1 e C2
  iniciarMonitoramentoLideres();
  // Inicia servidor gRPC na porta 3003
  grpcServer.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error(`[${CONTROLLER_ID}] Erro ao vincular porta gRPC ${GRPC_PORT}:`, err);
        return;
      }
      console.log(`=====================================================`);
      console.log(`[MIDDLEWARE gRPC] ${CONTROLLER_ID} (RÉPLICA BIZANTINA) ativo na porta ${port}`);
      // Exibe o status real de conexão com o MongoDB 3 ou Fallback RAM
      console.log(`   -> Armazenamento: ${persistenciaMongo.obterArmazenamentoId()}`);
      console.log(`   -> Simulação Bizantina: ${simularFalhaBizantina ? 'ATIVA' : 'INATIVA'}`);
      console.log(`=====================================================`);
    }
  );
}

// Dispara a inicialização ordenada do Controlador 3
iniciarServidor();
