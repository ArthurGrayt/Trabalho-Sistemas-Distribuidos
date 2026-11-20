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

// Classe que implementa o Objeto Distribuído da Réplica 3
class ControladorProcessoSala3 {
  // Retorna um snapshot seguro do estado em memória evitando sobrescrita fora da fila durante polling
  public async obterStatus() {
    // Clona o estado confirmado em memória sem sobrescrevê-lo durante leituras concorrentes
    const estadoReal = clonarEstado(estadoConfirmado);
    // Adultera apenas a cópia retornada se a simulação bizantina estiver ligada
    const estadoRetornado = simularFalhaBizantina ? gerarEstadoAdulterado(estadoReal) : estadoReal;

    return {
      controlador: CONTROLLER_ID,
      porta: GRPC_PORT,
      armazenamentoId: persistenciaMongo.obterArmazenamentoId(),
      integridade: simularFalhaBizantina ? 'FALHA_BIZANTINA' : 'HONESTO',
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

    // Executa normalmente se estiver operando em modo honesto
    estadoConfirmado = aplicarModoCalmaManual(estadoConfirmado, origemCliente);
    estadoTelemetria = clonarEstado(estadoConfirmado);
    const gravouBanco = await salvarReplicaMongoDB('INVOCACAO_METODO', `Modo Calma Manual (${origemCliente})`, true);
    // Publica aos atuadores somente se o cliente MQTT já estiver inicializado
    if (mqttClient) {
      publicarComandosAtuadores(mqttClient, estadoConfirmado, CONTROLLER_ID);
    }

    return {
      sucesso: true,
      metodoInvocado: 'ativarModoCalmaManual()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: gravouBanco
        ? `Método executado e persistido no MongoDB 3 pelo ${CONTROLLER_ID}!`
        : `Método executado e mantido em RAM (MongoDB 3 offline) pelo ${CONTROLLER_ID}!`,
      estado: estadoConfirmado,
      simularFalhaBizantina: false,
    };
  }

  // Configura atuadores caso C1 e C2 estejam offline (contingência extrema)
  public async configurarAtuadores(
    origemCliente: string,
    parametros: { corLuz?: string; somSpeaker?: string; textoDisplay?: string }
  ) {
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

    estadoConfirmado = aplicarConfigurarAtuadores(estadoConfirmado, parametros);
    estadoTelemetria = clonarEstado(estadoConfirmado);
    const gravouBanco = await salvarReplicaMongoDB(
      'INVOCACAO_METODO',
      `Configuração de atuadores (${origemCliente}) via ${CONTROLLER_ID}`,
      true
    );
    // Publica aos atuadores somente se o cliente MQTT já estiver inicializado
    if (mqttClient) {
      publicarComandosAtuadores(mqttClient, estadoConfirmado, CONTROLLER_ID);
    }

    return {
      sucesso: true,
      metodoInvocado: 'configurarAtuadores()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: gravouBanco
        ? `Atuadores configurados e persistidos no MongoDB 3!`
        : `Atuadores configurados e mantidos em RAM (MongoDB 3 offline)!`,
      estado: estadoConfirmado,
      simularFalhaBizantina: false,
    };
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
    try {
      const dados = JSON.parse(message.toString());
      const resultado = aplicarEventoMqtt(estadoTelemetria, topic, dados);
      if (resultado.relevante) {
        estadoTelemetria = resultado.candidato;
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
    try {
      const status = await objetoControlador.obterStatus();
      callback(null, {
        controlador: status.controlador,
        porta: status.porta,
        armazenamentoId: status.armazenamentoId,
        integridade: status.integridade,
        estado: sanitizarEstadoParaGrpc(status.estado),
      });
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err?.message || 'Erro' });
    }
  },

  // Handler RPC AtivarModoCalmaManual
  AtivarModoCalmaManual: async (call: any, callback: any) => {
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
      });
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err?.message });
    }
  },

  // Handler RPC InvocarMetodo
  InvocarMetodo: async (call: any, callback: any) => {
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
        });
      }
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err?.message });
    }
  },

  // Alterna a flag de simulação de falha bizantina e retorna seu novo estado no campo dedicado
  ToggleBizantino: async (_call: any, callback: any) => {
    simularFalhaBizantina = !simularFalhaBizantina;
    console.log(`⚠️ [${CONTROLLER_ID}] Modo Falha Bizantina alterado via gRPC para: ${simularFalhaBizantina ? 'ATIVO' : 'INATIVO'}`);
    callback(null, {
      sucesso: true,
      metodoInvocado: 'ToggleBizantino()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: `Simulação de Falha Bizantina alterada para: ${simularFalhaBizantina ? 'ATIVO' : 'INATIVO'}`,
      estado: sanitizarEstadoParaGrpc(estadoConfirmado),
      simularFalhaBizantina,
    });
  },
});

// Registra os métodos do serviço interno ConsensoInterno
grpcServer.addService(diverterapiaProto.ConsensoInterno.service, {
  // Handler RPC VotarEstado: adultera se flag ativa ou vota honestamente (inclusive INVOCACAO_METODO) se inativa
  VotarEstado: async (call: any, callback: any) => {
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
