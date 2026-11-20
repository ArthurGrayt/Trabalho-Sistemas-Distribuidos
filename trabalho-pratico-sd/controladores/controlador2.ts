// Importa o módulo gRPC nativo para servidor e cliente RPC entre nós do cluster
import * as grpc from '@grpc/grpc-js';
// Importa o proto-loader para carregar o contrato Protobuf compartilhado
import * as protoLoader from '@grpc/proto-loader';
// Importa o módulo nativo 'path' para localizar o arquivo .proto
import path from 'path';
// Importa a biblioteca 'mqtt' para receber telemetria e publicar comandos em caso de failover
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

// Define a porta gRPC do Controlador 1 (Líder) para heartbeat e catch-up configurável via env
const GRPC_PORT_1 = Number(process.env.GRPC_PORT_1 || 3001);
// Define a porta gRPC exclusiva do Controlador 2 (Réplica Honesta / Líder Interino)
const GRPC_PORT = Number(process.env.GRPC_PORT_2 || 3002);
// Define a porta gRPC do Controlador 3 para consenso interino em caso de failover
const GRPC_PORT_3 = Number(process.env.GRPC_PORT_3 || 3003);
// Define o identificador único deste Controlador de Processo
const CONTROLLER_ID = 'controlador-2';
// Define a URL do Broker MQTT Eclipse Mosquitto
const BROKER_URL = 'mqtt://127.0.0.1:1883';

// Resolve o caminho absoluto do contrato Protobuf único na raiz do projeto
const PROTO_PATH = path.resolve(__dirname, '../proto/diverterapia.proto');

// Carrega as definições do arquivo .proto com opções padronizadas
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  // Mantém nomes em camelCase conforme o contrato .proto
  keepCase: true,
  // Converte int64 para strings no transporte gRPC
  longs: String,
  // Mantém enums como strings legíveis
  enums: String,
  // Preenche valores default para campos não preenchidos
  defaults: true,
  // Habilita suporte a oneofs
  oneofs: true,
});

// Extrai o pacote 'diverterapia' do descritor carregado
const diverterapiaProto = (grpc.loadPackageDefinition(packageDefinition) as any).diverterapia;

// Armazena o estado oficialmente efetivado e persistido no MongoDB 2
let estadoConfirmado: EstadoSala = criarEstadoInicial();
// Armazena o estado calculado independentemente via MQTT para emissão de votos em VotarEstado
let estadoTelemetria: EstadoSala = criarEstadoInicial();
// Flag que rastreia se o Controlador Líder 1 está online ou se o Controlador 2 assumiu como Líder Interino
let liderPrincipalOnline = true;
// Flag que controla a simulação de falha por parada (Crash Fault) acionada via Dashboard
let falhaParadaSimulada = false;

// Instancia o gerenciador unificado de persistência para a instância MongoDB 2
const persistenciaMongo = criarGerenciadorMongo({
  // Identifica o controlador nos logs e na trilha de inicialização
  controllerId: CONTROLLER_ID,
  // Vincula à instância ordinal 2 do MongoDB
  numeroInstancia: 2,
  // Permite sobrescrever a URI via variável de ambiente MONGO_URI_2
  nomeVarEnv: 'MONGO_URI_2',
  // Define a URI local padrão do Docker Compose para o Controlador 2
  uriPadrao: 'mongodb://127.0.0.1:27018/diverterapia',
  // Fornece acesso ao estado confirmado em memória para sincronização pós-reconexão
  obterEstadoAtual: () => estadoConfirmado,
  // Atualiza estadoConfirmado e estadoTelemetria quando o crash-recovery ou reconexão recuperar dados do banco
  aplicarEstadoRecuperado: (estadoRecuperado) => {
    // Atualiza o estado confirmado com o snapshot recuperado do banco
    estadoConfirmado = estadoRecuperado;
    // Espelha o buffer independente de telemetria para manter votação consistente
    estadoTelemetria = clonarEstado(estadoRecuperado);
  },
});

// Fila sequencial para serializar operações de liderança interina durante failover
let filaOperacoes: Promise<void> = Promise.resolve();

// Função auxiliar que encadeia tarefas críticas em ordem FIFO
function enfileirarOperacao<T>(tarefa: () => Promise<T>): Promise<T> {
  // Encadeia a execução garantindo que não haja sobreposição entre chamadas
  const execucao = filaOperacoes.then(tarefa, tarefa);
  // Atualiza o ponteiro da fila evitando bloqueio em caso de erro
  filaOperacoes = execucao.then(
    () => undefined,
    () => undefined
  );
  // Retorna a Promise original da tarefa
  return execucao;
}

// Função auxiliar para aguardar milissegundos em sincronizações assíncronas
function esperarMs(ms: number): Promise<void> {
  // Retorna uma Promise resolvida após o timeout
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Define opções de reconexão rápida para os clientes gRPC internos de heartbeat e failover
const GRPC_INTERNO_OPTIONS: grpc.ClientOptions = {
  // Reduz o backoff inicial de reconexão HTTP/2 de 1000ms para 150ms após queda ou reinicialização
  'grpc.initial_reconnect_backoff_ms': 150,
  // Limita o backoff máximo em 1000ms
  'grpc.max_reconnect_backoff_ms': 1000,
};

// Clientes gRPC internos para checar saúde do Líder 1 e coordenar o nó 3 durante failover
const clientLider1 = new diverterapiaProto.MiddlewareClinico(
  `127.0.0.1:${GRPC_PORT_1}`,
  grpc.credentials.createInsecure(),
  GRPC_INTERNO_OPTIONS
);
const clientConsenso3 = new diverterapiaProto.ConsensoInterno(
  `127.0.0.1:${GRPC_PORT_3}`,
  grpc.credentials.createInsecure(),
  GRPC_INTERNO_OPTIONS
);

// Persiste estadoConfirmado no MongoDB 2 adicionando entrada no histórico apenas quando gerado localmente
async function salvarReplicaMongoDB(
  tipo: string,
  descricao: string,
  adicionarHistorico: boolean = false
): Promise<boolean> {
  // Delega ao gerenciador compartilhado retornando true apenas quando gravado em disco
  return persistenciaMongo.anexarHistoricoEPersistir(estadoConfirmado, tipo, descricao, adicionarHistorico);
}

// Executa catch-up automático no boot consultando o Líder 1 caso a Réplica 2 tenha ficado offline
async function sincronizarCatchUpComLider(): Promise<void> {
  // Encapsula a consulta gRPC em Promise que sempre resolve para não travar boot simultâneo
  await new Promise<void>((resolve) => {
    // Instancia cliente temporário isolado para não contaminar o subchannel pool do heartbeat de clientLider1
    const clientCatchUp = new diverterapiaProto.MiddlewareClinico(
      `127.0.0.1:${GRPC_PORT_1}`,
      grpc.credentials.createInsecure(),
      { 'grpc.use_local_subchannel_pool': 1 }
    );
    // Define deadline curto de 600ms para consultar o Controlador 1
    const deadline = new Date(Date.now() + 600);
    // Solicita o estado consolidado atual mantido pelo Líder 1
    clientCatchUp.ObterStatus({}, new grpc.Metadata(), { deadline }, async (err: any, response: any) => {
      // Encerra o cliente temporário de catch-up liberando o canal isolado
      clientCatchUp.close();
      // Segue normalmente se o Líder estiver offline ou responder sem estado válido
      if (err || response?.integridade === 'FALHA_BIZANTINA' || !response?.estado?.ultimaAtualizacao) {
        resolve();
        return;
      }
      // Normaliza o estado retornado pelo Líder para comparação determinística
      const estadoLider = normalizarEstadoRecebido(response.estado);
      // Verifica se o estado do Líder é mais atual ou possui eventos clínicos que faltam localmente
      if (deveAbsorverEstadoRemoto(estadoConfirmado, estadoLider)) {
        // Atualiza o estado confirmado com o snapshot oficial do Líder
        estadoConfirmado = estadoLider;
        // Sincroniza o estado independente de telemetria para que os próximos votos batam
        estadoTelemetria = clonarEstado(estadoLider);
        // Grava no MongoDB 2 preservando o histórico consolidado do Líder
        const gravouBanco = await persistenciaMongo.persistirEstado(estadoConfirmado);
        // Registra no terminal a conclusão do catch-up
        console.log(
          `🔄 [${CONTROLLER_ID}] Catch-up concluído a partir do Controlador 1 (:${GRPC_PORT_1}) — ${
            gravouBanco ? 'salvo no MongoDB 2!' : 'mantido em RAM (MongoDB 2 offline).'
          }`
        );
      }
      // Conclui a sincronização inicial
      resolve();
    });
  });
}

// Solicita voto do Controlador 3 durante operação em modo Líder Interino (Failover)
function pedirVotoNo3(tipoEvento: string, candidato: EstadoSala): Promise<any> {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + 600);
    // Configura waitForReady para aguardar handshake de reconexão dentro do deadline
    const metadata = new grpc.Metadata({ waitForReady: true });
    clientConsenso3.VotarEstado(
      {
        liderId: CONTROLLER_ID,
        tipoEvento,
        estadoCandidato: sanitizarEstadoParaGrpc(candidato),
      },
      metadata,
      { deadline },
      (err: any, response: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      }
    );
  });
}

// Envia o estado validado ao Controlador 3 durante failover para manter o MongoDB 3 sincronizado
async function enviarEfetivacaoParaNo3(tipoEvento: string, descricao: string, estadoValidado: EstadoSala): Promise<void> {
  const payload = {
    liderId: CONTROLLER_ID,
    tipo: tipoEvento,
    descricao,
    estadoValidado: sanitizarEstadoParaGrpc(estadoValidado),
  };
  await new Promise<void>((resolve) => {
    const deadline = new Date(Date.now() + 800);
    // Configura waitForReady para garantir entrega caso o canal para o Nó 3 esteja reconectando
    const metadata = new grpc.Metadata({ waitForReady: true });
    clientConsenso3.EfetivarEstado(payload, metadata, { deadline }, (err: any) => {
      if (err) {
        console.warn(`[${CONTROLLER_ID}] Réplica 3 não confirmou efetivação em failover:`, err.message);
      }
      resolve();
    });
  });
}

// Coordena votação com Nó 3, commit no MongoDB 2, replicação para Nó 3 e atuação MQTT quando Líder Interino
async function executarComoLiderInterino(
  tipoEvento: string,
  descricao: string,
  candidato: EstadoSala,
  publicarAtuadores: boolean
): Promise<boolean> {
  // Tenta validar o estado candidato junto ao Controlador 3
  let infoVotoNo3 = 'Réplica 3 (:3003): OFFLINE';
  let votos = 1;
  try {
    const voto3 = await pedirVotoNo3(tipoEvento, candidato);
    if (voto3?.aprova && compararEstados(candidato, voto3.estadoVotado)) {
      votos++;
      infoVotoNo3 = 'Réplica 3 (:3003): APROVADO (Quorum 2/2 Interino)';
    } else {
      infoVotoNo3 = `Réplica 3 (:3003): DESCARTADO POR FALHA BIZANTINA (Ruído: ${voto3?.estadoVotado?.ruidoDb}dB)`;
    }
  } catch {
    // Caso nó 3 esteja offline, prossegue em contingência de alta disponibilidade no Líder Interino
  }

  // Loga a decisão tomada em regime de failover
  console.log(`👑 [${CONTROLLER_ID} - LÍDER INTERINO] ${descricao} | Votos: ${votos}/2 | [${infoVotoNo3}]`);

  // Atualiza os estados confirmados e de telemetria locais
  estadoConfirmado = normalizarEstadoRecebido(candidato);
  estadoTelemetria = clonarEstado(estadoConfirmado);

  // Grava o estado no MongoDB 2 (ou mantém em RAM) marcando que foi efetivado pelo Líder Interino
  const persistidoMongo = await salvarReplicaMongoDB(
    tipoEvento,
    `${descricao} [Efetivado por Líder Interino C2]`,
    true
  );

  // Replica o estado válido no MongoDB 3 (sobrescrevendo qualquer divergência bizantina)
  await enviarEfetivacaoParaNo3(tipoEvento, `${descricao} [Efetivado por Líder Interino C2]`, estadoConfirmado);

  // Publica as ordens físicas aos atuadores via Mosquitto para manter a sala responsiva sem o C1
  if (publicarAtuadores && mqttClient) {
    publicarComandosAtuadores(mqttClient, estadoConfirmado, CONTROLLER_ID);
  }

  // Registra no console o status real da gravação na instância MongoDB 2
  if (!persistidoMongo) {
    console.warn(`⚠️ [${CONTROLLER_ID} - LÍDER INTERINO] MongoDB 2 offline — estado mantido em RAM.`);
  }

  // Retorna sucesso operacional do failover
  return true;
}

// Classe que implementa o Objeto Distribuído do Controlador 2
class ControladorProcessoSala2 {
  // Retorna um snapshot seguro do estado em memória evitando sobrescrita fora da fila durante polling
  public async obterStatus() {
    // Clona o estado confirmado já sincronizado para evitar race conditions em leituras concorrentes
    const estadoAtual = clonarEstado(estadoConfirmado);
    // Retorna status completo indicando conectividade real do MongoDB 2
    return {
      controlador: CONTROLLER_ID,
      porta: GRPC_PORT,
      armazenamentoId: persistenciaMongo.obterArmazenamentoId(),
      integridade: liderPrincipalOnline ? 'HONESTO' : 'LIDER_INTERINO',
      estado: estadoAtual,
    };
  }

  // Ativa o Modo Calma em regime de Failover (Líder Interino), gravando no MongoDB 2 e acionando atuadores
  public async ativarModoCalmaManual(origemCliente: string) {
    // Se o gateway acionou este método diretamente, assume imediatamente que C1 caiu
    if (liderPrincipalOnline) {
      liderPrincipalOnline = false;
      console.log(`👑 [${CONTROLLER_ID}] Controlador 1 offline! Assumindo liderança interina (Failover).`);
    }
    return enfileirarOperacao(async () => {
      const candidato = aplicarModoCalmaManual(estadoConfirmado, origemCliente);
      await executarComoLiderInterino(
        'INVOCACAO_METODO',
        `Modo Calma Manual via Failover (${origemCliente})`,
        candidato,
        true
      );
      // Define a descrição fiel do local onde o estado foi salvo
      const destino = persistenciaMongo.estaConectado()
        ? 'persistido no MongoDB 2'
        : 'mantido em RAM (MongoDB 2 offline)';
      return {
        sucesso: true,
        metodoInvocado: 'ativarModoCalmaManual()',
        processadoPor: CONTROLLER_ID,
        porta: GRPC_PORT,
        mensagem: `Método executado em Failover (Líder Interino) e ${destino} pelo ${CONTROLLER_ID}!`,
        estado: estadoConfirmado,
        simularFalhaBizantina: false,
      };
    });
  }

  // Configura atuadores em regime de Failover (Líder Interino), gravando no MongoDB 2 e acionando atuadores
  public async configurarAtuadores(
    origemCliente: string,
    parametros: { corLuz?: string; somSpeaker?: string; textoDisplay?: string }
  ) {
    if (liderPrincipalOnline) {
      liderPrincipalOnline = false;
      console.log(`👑 [${CONTROLLER_ID}] Controlador 1 offline! Assumindo liderança interina (Failover).`);
    }
    return enfileirarOperacao(async () => {
      const candidato = aplicarConfigurarAtuadores(estadoConfirmado, parametros);
      await executarComoLiderInterino(
        'INVOCACAO_METODO',
        `Configuração de atuadores via Failover (${origemCliente})`,
        candidato,
        true
      );
      // Define a descrição fiel do local onde a configuração foi salva
      const destino = persistenciaMongo.estaConectado()
        ? 'persistidos no MongoDB 2'
        : 'mantidos em RAM (MongoDB 2 offline)';
      return {
        sucesso: true,
        metodoInvocado: 'configurarAtuadores()',
        processadoPor: CONTROLLER_ID,
        porta: GRPC_PORT,
        mensagem: `Atuadores configurados em Failover (Líder Interino) e ${destino}!`,
        estado: estadoConfirmado,
        simularFalhaBizantina: false,
      };
    });
  }
}

// Instancia o objeto distribuído da Réplica 2
const objetoControlador = new ControladorProcessoSala2();

// Referência ao cliente MQTT inicializado apenas após o recovery do MongoDB 2
let mqttClient: mqtt.MqttClient | null = null;

// Conecta ao Broker MQTT Eclipse Mosquitto e registra os handlers de telemetria após o boot ordenado
function iniciarMqtt(): void {
  // Inicializa o cliente MQTT com identificador exclusivo para o Controlador 2
  const client = mqtt.connect(BROKER_URL, {
    // Identificador exclusivo da sessão MQTT do Controlador 2
    clientId: `${CONTROLLER_ID}_${Math.random().toString(16).slice(2, 6)}`,
  });
  // Armazena a referência ativa no escopo do módulo
  mqttClient = client;

  // Assina os tópicos de telemetria e recepção ao conectar no broker
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

  // Processa todas as mensagens MQTT atualizando estadoTelemetria e assumindo liderança se C1 estiver offline
  client.on('message', (topic, message) => {
    // Interrompe processamento se o nó estiver com falha por parada (Crash) simulada
    if (falhaParadaSimulada) {
      // Ignora mensagem MQTT simulando nó inativo
      return;
    }
    try {
      // Converte o payload recebido para objeto JSON
      const dados = JSON.parse(message.toString());
      // Aplica as regras clínicas determinísticas sobre estadoTelemetria para fundamentar votos honestos
      const resultadoTelemetria = aplicarEventoMqtt(estadoTelemetria, topic, dados);
      if (!resultadoTelemetria.relevante) {
        return;
      }
      // Atualiza o estado independente de telemetria
      estadoTelemetria = resultadoTelemetria.candidato;

      // Caso o Líder 1 esteja offline, o Controlador 2 processa, persiste no MongoDB 2 e aciona atuadores
      if (!liderPrincipalOnline) {
        enfileirarOperacao(async () => {
          // Verifica novamente dentro da fila caso C1 tenha retornado enquanto aguardava
          if (liderPrincipalOnline) return;
          // Calcula o próximo estado confirmado a partir de estadoConfirmado + evento MQTT
          const resInterino = aplicarEventoMqtt(estadoConfirmado, topic, dados);
          if (resInterino.relevante) {
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
      // Ignora mensagens MQTT com JSON inválido
    }
  });
}

// Inicia o heartbeat periódico de 1500ms para detectar queda ou retorno do Controlador Líder 1
function iniciarMonitoramentoLider(): void {
  setInterval(() => {
    // Se o próprio Controlador 2 estiver com simulação de crash, não executa heartbeat nem tenta assumir
    if (falhaParadaSimulada) {
      // Ignora verificação enquanto o nó estiver simulando parada
      return;
    }
    const deadline = new Date(Date.now() + 600);
    clientLider1.ObterStatus({}, new grpc.Metadata(), { deadline }, (err: any) => {
      if (err) {
        // Se o Líder 1 deixou de responder, ativa modo Líder Interino
        if (liderPrincipalOnline) {
          liderPrincipalOnline = false;
          console.log(`👑 [${CONTROLLER_ID}] Controlador 1 offline! Assumindo liderança interina (Failover).`);
        }
      } else {
        // Se o Líder 1 voltou a responder, retorna ao papel de Réplica Honesta
        if (!liderPrincipalOnline) {
          liderPrincipalOnline = true;
          console.log(`🔄 [${CONTROLLER_ID}] Controlador 1 restaurado. Retornando ao modo Réplica Honesta.`);
        }
      }
    });
  }, 1500);
}

// Instancia o servidor gRPC puro na porta 3002
const grpcServer = new grpc.Server();

// Registra os métodos do serviço externo MiddlewareClinico
grpcServer.addService(diverterapiaProto.MiddlewareClinico.service, {
  // Handler RPC ObterStatus
  ObterStatus: async (_call: any, callback: any) => {
    // Interrompe imediatamente se o nó estiver com falha por parada (Crash) simulada
    if (falhaParadaSimulada) {
      // Retorna erro gRPC UNAVAILABLE simulando processo fora do ar
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 2 offline (Simulação de Falha por Parada / Crash).',
      });
      // Encerra
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

  // Handler RPC AtivarModoCalmaManual (Failover)
  AtivarModoCalmaManual: async (call: any, callback: any) => {
    // Rejeita a requisição se o nó estiver derrubado
    if (falhaParadaSimulada) {
      // Retorna status UNAVAILABLE
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 2 offline (Simulação de Falha por Parada / Crash).',
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

  // Handler RPC InvocarMetodo (Failover)
  InvocarMetodo: async (call: any, callback: any) => {
    // Rejeita a execução remota se o nó estiver simulando parada
    if (falhaParadaSimulada) {
      // Retorna UNAVAILABLE
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 2 offline (Simulação de Falha por Parada / Crash).',
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

  // Handler RPC ToggleBizantino (Controlador 2 permanece sempre honesto)
  ToggleBizantino: async (_call: any, callback: any) => {
    // Rejeita se o nó estiver offline
    if (falhaParadaSimulada) {
      // Retorna UNAVAILABLE
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 2 offline (Simulação de Falha por Parada / Crash).',
      });
      // Retorna
      return;
    }
    callback(null, {
      sucesso: true,
      metodoInvocado: 'ToggleBizantino()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: 'Controlador 2 é Réplica Honesta.',
      estado: sanitizarEstadoParaGrpc(estadoConfirmado),
      simularFalhaBizantina: false,
      falhaParadaSimulada,
    });
  },

  // Handler RPC AlternarStatusOperacional (Derrubar ou Reviver o Controlador 2)
  AlternarStatusOperacional: async (_call: any, callback: any) => {
    // Inverte a flag de simulação de parada
    falhaParadaSimulada = !falhaParadaSimulada;
    // Se revivido, restaura prontidão
    if (!falhaParadaSimulada) {
      // Loga recuperação no console
      console.log(`[${CONTROLLER_ID}] 🔄 Controlador 2 revivido! Monitoramento e prontidão restaurados.`);
    } else {
      // Loga parada simulada no console
      console.log(`[${CONTROLLER_ID}] 💀 Controlador 2 derrubado! Simulação de Crash ativada.`);
    }
    // Retorna resposta RPC com o novo status
    callback(null, {
      sucesso: true,
      metodoInvocado: 'AlternarStatusOperacional()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: falhaParadaSimulada
        ? 'Controlador 2 derrubado (Falha de Parada / Crash ativa).'
        : 'Controlador 2 recuperado com sucesso!',
      estado: sanitizarEstadoParaGrpc(estadoConfirmado),
      simularFalhaBizantina: false,
      falhaParadaSimulada,
    });
  },
});

// Registra os métodos do serviço interno ConsensoInterno para votação e commit coordenados pelo Líder
grpcServer.addService(diverterapiaProto.ConsensoInterno.service, {
  // Emite voto honesto e independente com sincronização fina para evitar race conditions MQTT
  VotarEstado: async (call: any, callback: any) => {
    // Se estiver derrubado, não participa de votação
    if (falhaParadaSimulada) {
      // Retorna erro gRPC
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 2 offline (Simulação de Crash).',
      });
      // Retorna
      return;
    }
    const { tipoEvento, estadoCandidato } = call.request;

    // Para comandos manuais RPC (que não trafegam nos tópicos de entrada MQTT), valida sanidade em cópia temporária
    if (tipoEvento === 'INVOCACAO_METODO' && estadoCandidato) {
      const tag = String(estadoCandidato.tagId || '');
      const ruido = Number(estadoCandidato.ruidoDb || 0);
      const bpm = Number(estadoCandidato.bpm || 0);
      // Verifica se os parâmetros recebidos respeitam os limites clínicos e integridade
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
          justificativa: 'Voto REJEITADO: parâmetros fora dos limites clínicos permitidos.',
        });
        return;
      }

      // Valida sem mutar estadoConfirmado antes da ordem explícita EfetivarEstado
      const estadoValidadoTemp = normalizarEstadoRecebido(estadoCandidato);
      console.log(`🗳️ [${CONTROLLER_ID}] Voto ÍNTEGRO emitido ao Líder sobre evento: ${tipoEvento}`);
      callback(null, {
        controlador: CONTROLLER_ID,
        porta: GRPC_PORT,
        aprova: true,
        estadoVotado: sanitizarEstadoParaGrpc(estadoValidadoTemp),
        justificativa: `Voto íntegro e favorável emitido pela Réplica Honesta 2 (Porta ${GRPC_PORT})`,
      });
      return;
    }

    // Para eventos originados via MQTT, aguarda até 160ms caso o pacote ainda esteja em trânsito no Mosquitto
    const tsAlvo = estadoCandidato?.ultimaAtualizacao;
    if (tsAlvo) {
      let tentativas = 0;
      while (estadoTelemetria.ultimaAtualizacao !== tsAlvo && tentativas < 8) {
        await esperarMs(20);
        tentativas++;
      }
    }

    // Emite voto estritamente baseado no estadoTelemetria calculado localmente via MQTT
    console.log(`🗳️ [${CONTROLLER_ID}] Voto ÍNTEGRO emitido ao Líder sobre evento: ${tipoEvento}`);
    callback(null, {
      controlador: CONTROLLER_ID,
      porta: GRPC_PORT,
      aprova: true,
      estadoVotado: sanitizarEstadoParaGrpc(estadoTelemetria),
      justificativa: `Voto íntegro e favorável emitido pela Réplica Honesta 2 (Porta ${GRPC_PORT})`,
    });
  },

  // Efetiva no MongoDB 2 o estado validado pelo Quorum do Líder sem duplicar registros no histórico
  EfetivarEstado: async (call: any, callback: any) => {
    // Se o nó estiver derrubado, não efetiva
    if (falhaParadaSimulada) {
      // Retorna erro gRPC
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Controlador 2 offline (Simulação de Crash).',
      });
      // Retorna
      return;
    }
    try {
      const { tipo, descricao, estadoValidado } = call.request;
      if (estadoValidado) {
        // Normaliza e atualiza ambos os buffers (confirmado e telemetria) com a verdade do Quorum
        estadoConfirmado = normalizarEstadoRecebido(estadoValidado);
        estadoTelemetria = clonarEstado(estadoConfirmado);
      }
      // Persiste preservando o histórico consolidado enviado pelo Líder (adicionarHistorico = false)
      const gravouBanco = await salvarReplicaMongoDB(tipo || 'CONSENSO', `${descricao} [Efetivado via Líder]`, false);
      callback(null, {
        sucesso: true,
        metodoInvocado: 'EfetivarEstado()',
        processadoPor: CONTROLLER_ID,
        porta: GRPC_PORT,
        mensagem: gravouBanco
          ? 'Estado validado pelo Quorum persistido no MongoDB 2!'
          : 'Estado validado pelo Quorum mantido em RAM (MongoDB 2 offline)!',
        estado: sanitizarEstadoParaGrpc(estadoConfirmado),
        simularFalhaBizantina: false,
      });
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err?.message || 'Erro ao efetivar' });
    }
  },
});

// Função de inicialização ordenada garantindo recovery do MongoDB 2 e catch-up antes do MQTT, heartbeat e gRPC
async function iniciarServidor(): Promise<void> {
  // Conecta, realiza crash-recovery do MongoDB 2 e ativa o monitor de reconexão automática
  await persistenciaMongo.inicializar();
  // Consulta o Controlador 1 para absorver eventos perdidos caso o Controlador 2 tenha reiniciado após queda
  await sincronizarCatchUpComLider();
  // Conecta ao Broker Mosquitto somente após finalizar o crash-recovery e catch-up
  iniciarMqtt();
  // Inicia monitoramento de disponibilidade do Líder 1
  iniciarMonitoramentoLider();
  // Sobe o servidor gRPC na porta 3002
  grpcServer.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error(`[${CONTROLLER_ID}] Erro ao vincular porta gRPC ${GRPC_PORT}:`, err);
        return;
      }
      console.log(`=====================================================`);
      console.log(`[MIDDLEWARE gRPC] ${CONTROLLER_ID} (RÉPLICA HONESTA / LÍDER INTERINO) ativo na porta ${port}`);
      // Exibe o status real de conexão com o MongoDB 2 ou Fallback RAM
      console.log(`   -> Armazenamento: ${persistenciaMongo.obterArmazenamentoId()}`);
      console.log(`   -> Serviço de Consenso: ConsensoInterno + Heartbeat Ativos`);
      console.log(`=====================================================`);
    }
  );
}

// Dispara a inicialização ordenada do Controlador 2
iniciarServidor();
