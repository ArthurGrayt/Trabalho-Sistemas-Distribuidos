// Importa o módulo gRPC nativo para comunicação de alto desempenho via chamadas RPC
import * as grpc from '@grpc/grpc-js';
// Importa o proto-loader para carregar dinamicamente o arquivo de definição de serviço Protobuf
import * as protoLoader from '@grpc/proto-loader';
// Importa o módulo nativo 'path' para resolver o caminho absoluto do arquivo .proto
import path from 'path';
// Importa a biblioteca 'mqtt' para conectar o controlador ao barramento Publish/Subscribe
import mqtt from 'mqtt';
// Importa o 'mongoose' para modelagem e persistência de dados na instância MongoDB 3
import mongoose, { Schema, Document } from 'mongoose';

// Define a porta gRPC exclusiva do Controlador de Processo 3 (3003) - Réplica Bizantina
const GRPC_PORT = 3003;
// Define o identificador único deste Controlador de Processo
const CONTROLLER_ID = 'controlador-3';
// Define a URL do Broker MQTT local na porta 1883
const BROKER_URL = 'mqtt://127.0.0.1:1883';
// Define a URI de conexão exclusiva com a instância MongoDB 3 na porta 27019
const MONGO_URI = 'mongodb://127.0.0.1:27019/diverterapia';
// Define a chave única do documento da Sala 1 na coleção do MongoDB
const SALA_DOC_ID = 'sala-1';

// Flag que controla a simulação de Falha Bizantina (inicia ativa como padrão de teste)
let simularFalhaBizantina = true;

// Resolve o caminho absoluto do contrato Protobuf compartilhado
const PROTO_PATH = path.resolve(__dirname, '../proto/diverterapia.proto');

// Carrega a definição do contrato .proto utilizando o proto-loader com opções tipadas
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

// Extrai o pacote 'diverterapia' a partir da definição carregada do gRPC
const diverterapiaProto = (grpc.loadPackageDefinition(packageDefinition) as any).diverterapia;

// Interface que representa um registro histórico persistido no documento do MongoDB
interface RegistroHistorico {
  horario: string;
  tipo: string;
  descricao: string;
}

// Interface para um item na Fila de Espera Distribuída de pacientes
interface ItemFilaEspera {
  nome: string;
  musica: string;
  cor: string;
  horario: string;
}

// Interface que modela o Objeto Distribuído da Sala 1 gerenciado pelo Middleware
interface EstadoSala {
  ruidoDb: number;
  bpm: number;
  presenca: boolean;
  tagId: string;
  musicaFavorita: string;
  corFavorita: string;
  iluminacao: string;
  smartSpeaker: string;
  displayPorta: string;
  modoCalmaAtivo: boolean;
  overrideManualAte: number;
  filaEspera: ItemFilaEspera[];
  ultimaAtualizacao: string;
  historico: RegistroHistorico[];
}

// Interface do documento Mongoose combinando EstadoSala e Document
interface EstadoSalaDocument extends EstadoSala, Document {
  salaId: string;
}

// Sub-schema do Mongoose para os itens da fila de espera
const ItemFilaSchema = new Schema<ItemFilaEspera>(
  {
    nome: { type: String, required: true },
    musica: { type: String, required: true },
    cor: { type: String, required: true },
    horario: { type: String, required: true },
  },
  { _id: false }
);

// Sub-schema do Mongoose para os registros de auditoria histórica
const RegistroHistoricoSchema = new Schema<RegistroHistorico>(
  {
    horario: { type: String, required: true },
    tipo: { type: String, required: true },
    descricao: { type: String, required: true },
  },
  { _id: false }
);

// Schema principal do Mongoose associado à coleção 'estados_sala' na instância MongoDB 3
const EstadoSalaSchema = new Schema<EstadoSalaDocument>(
  {
    salaId: { type: String, required: true, unique: true, default: SALA_DOC_ID },
    ruidoDb: { type: Number, required: true, default: 62 },
    bpm: { type: Number, required: true, default: 80 },
    presenca: { type: Boolean, required: true, default: false },
    tagId: { type: String, required: true, default: 'Nenhum paciente' },
    musicaFavorita: { type: String, required: true, default: 'Aguardando paciente' },
    corFavorita: { type: String, required: true, default: 'Branco' },
    iluminacao: { type: String, required: true, default: 'Branca / Alto Contraste' },
    smartSpeaker: { type: String, required: true, default: 'Aguardando paciente' },
    displayPorta: { type: String, required: true, default: '> Sala 1 - Livre' },
    modoCalmaAtivo: { type: Boolean, required: true, default: false },
    overrideManualAte: { type: Number, required: true, default: 0 },
    filaEspera: { type: [ItemFilaSchema], default: [] },
    ultimaAtualizacao: { type: String, required: true, default: () => new Date().toISOString() },
    historico: { type: [RegistroHistoricoSchema], default: [] },
  },
  { versionKey: false }
);

// Cria o Model Mongoose associado à coleção 'estados_sala' na instância MongoDB 3
const EstadoSalaModel = mongoose.model<EstadoSalaDocument>('EstadoSala', EstadoSalaSchema, 'estados_sala');

// Inicializa o estado em memória espelhado com o documento do MongoDB 3
const estadoLocal: EstadoSala = {
  ruidoDb: 62,
  bpm: 80,
  presenca: false,
  tagId: 'Nenhum paciente',
  musicaFavorita: 'Aguardando paciente',
  corFavorita: 'Branco',
  iluminacao: 'Branca / Alto Contraste',
  smartSpeaker: 'Aguardando paciente',
  displayPorta: '> Sala 1 - Livre',
  modoCalmaAtivo: false,
  overrideManualAte: 0,
  filaEspera: [],
  ultimaAtualizacao: new Date().toISOString(),
  historico: [],
};

// Função assíncrona que persiste o estado atual na instância MongoDB 3
async function salvarReplicaMongoDB(tipo: string, descricao: string): Promise<void> {
  const novoRegistro: RegistroHistorico = {
    horario: new Date().toISOString(),
    tipo,
    descricao,
  };
  estadoLocal.historico = [novoRegistro, ...estadoLocal.historico.slice(0, 14)];

  if (mongoose.connection.readyState !== 1) {
    return;
  }

  try {
    await EstadoSalaModel.findOneAndUpdate(
      { salaId: SALA_DOC_ID },
      { $set: { salaId: SALA_DOC_ID, ...estadoLocal } },
      { upsert: true, new: true }
    ).lean();
  } catch (err) {
    console.error(`[${CONTROLLER_ID}] Erro ao persistir no MongoDB 3 (${MONGO_URI}):`, err);
  }
}

// Função assíncrona que lê o estado diretamente do MongoDB 3
async function carregarEstadoDoMongoDB(): Promise<EstadoSala> {
  if (mongoose.connection.readyState === 1) {
    try {
      const doc = await EstadoSalaModel.findOne({ salaId: SALA_DOC_ID }).lean();
      if (doc) {
        estadoLocal.ruidoDb = doc.ruidoDb;
        estadoLocal.bpm = doc.bpm;
        estadoLocal.presenca = doc.presenca;
        estadoLocal.tagId = doc.tagId;
        estadoLocal.musicaFavorita = doc.musicaFavorita;
        estadoLocal.corFavorita = doc.corFavorita;
        estadoLocal.iluminacao = doc.iluminacao;
        estadoLocal.smartSpeaker = doc.smartSpeaker;
        estadoLocal.displayPorta = doc.displayPorta;
        estadoLocal.modoCalmaAtivo = doc.modoCalmaAtivo;
        estadoLocal.overrideManualAte = doc.overrideManualAte;
        estadoLocal.filaEspera = doc.filaEspera || [];
        estadoLocal.ultimaAtualizacao = doc.ultimaAtualizacao;
        estadoLocal.historico = doc.historico || [];
      }
    } catch (err) {
      console.error(`[${CONTROLLER_ID}] Erro ao ler estado no MongoDB 3:`, err);
    }
  }
  return estadoLocal;
}

// Inicializa a conexão com o MongoDB 3
async function inicializarMongoDB(): Promise<void> {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`[${CONTROLLER_ID}] Conectado com sucesso ao MongoDB 3 em ${MONGO_URI}`);
    const docExistente = await EstadoSalaModel.findOne({ salaId: SALA_DOC_ID }).lean();
    if (docExistente) {
      await carregarEstadoDoMongoDB();
      console.log(`[${CONTROLLER_ID}] Estado recuperado do MongoDB 3.`);
    } else {
      await salvarReplicaMongoDB('INICIALIZACAO', `${CONTROLLER_ID} inicializou o documento no MongoDB 3`);
    }
  } catch (err) {
    console.error(`[${CONTROLLER_ID}] Erro ao conectar no MongoDB 3 (${MONGO_URI}):`, err);
  }
}

// Função auxiliar de sanitização de dados para contrato gRPC
function sanitizarEstadoParaGrpc(doc: any): any {
  return {
    ruidoDb: Math.round(Number(doc?.ruidoDb) || 62),
    bpm: Math.round(Number(doc?.bpm) || 80),
    presenca: Boolean(doc?.presenca),
    tagId: String(doc?.tagId || 'Nenhum paciente'),
    musicaFavorita: String(doc?.musicaFavorita || 'Aguardando paciente'),
    corFavorita: String(doc?.corFavorita || 'Branco'),
    iluminacao: String(doc?.iluminacao || 'Branca / Alto Contraste'),
    smartSpeaker: String(doc?.smartSpeaker || 'Aguardando paciente'),
    displayPorta: String(doc?.displayPorta || '> Sala 1 - Livre'),
    modoCalmaAtivo: Boolean(doc?.modoCalmaAtivo),
    overrideManualAte: Math.round(Number(doc?.overrideManualAte) || 0),
    filaEspera: Array.isArray(doc?.filaEspera)
      ? doc.filaEspera.map((item: any) => ({
          nome: String(item?.nome || ''),
          musica: String(item?.musica || ''),
          cor: String(item?.cor || ''),
          horario: String(item?.horario || ''),
        }))
      : [],
    ultimaAtualizacao: String(doc?.ultimaAtualizacao || new Date().toISOString()),
    historico: Array.isArray(doc?.historico)
      ? doc.historico.map((h: any) => ({
          horario: String(h?.horario || ''),
          tipo: String(h?.tipo || ''),
          descricao: String(h?.descricao || ''),
        }))
      : [],
  };
}

// Classe que implementa o Objeto Distribuído da Réplica 3
class ControladorProcessoSala3 {
  public async obterStatus() {
    const estadoReal = await carregarEstadoDoMongoDB();
    const estadoRetornado = simularFalhaBizantina
      ? {
          ruidoDb: 999,
          bpm: 250,
          presenca: !estadoReal.presenca,
          tagId: 'DADO_ADULTERADO_BIZANTINO',
          musicaFavorita: 'sirene-descalibrada',
          corFavorita: 'vermelho-bizantino',
          iluminacao: 'Vermelho / Alerta Falso',
          smartSpeaker: 'Sirene Descalibrada',
          displayPorta: '> ERRO BIZANTINO / INVASÃO DETECTADA',
          modoCalmaAtivo: !estadoReal.modoCalmaAtivo,
          overrideManualAte: estadoReal.overrideManualAte,
          filaEspera: [{ nome: 'HACKED-USER', musica: 'Noise', cor: 'Preto', horario: '99:99' }],
          ultimaAtualizacao: estadoReal.ultimaAtualizacao,
          historico: estadoReal.historico,
        }
      : estadoReal;

    return {
      controlador: CONTROLLER_ID,
      porta: GRPC_PORT,
      armazenamentoId: 'MongoDB 3 (mongodb://127.0.0.1:27019/diverterapia)',
      integridade: simularFalhaBizantina ? 'FALHA_BIZANTINA' : 'HONESTO',
      estado: estadoRetornado,
    };
  }

  public async ativarModoCalmaManual(origemCliente: string) {
    estadoLocal.overrideManualAte = Date.now() + 15000;
    estadoLocal.iluminacao = 'Azul / Calmante';
    estadoLocal.smartSpeaker = 'Frequência Calmante (Ruído Branco)';
    estadoLocal.displayPorta = '> Regulação em Curso (Não Entre)';
    estadoLocal.modoCalmaAtivo = true;
    estadoLocal.ultimaAtualizacao = new Date().toISOString();
    await salvarReplicaMongoDB('INVOCACAO_METODO', `Modo Calma Manual (${origemCliente})`);

    return {
      sucesso: true,
      metodoInvocado: 'ativarModoCalmaManual()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      armazenamentoAtualizado: 'MongoDB 3 (27019)',
      mensagem: `Método executado e persistido no MongoDB 3 pelo ${CONTROLLER_ID}!`,
      estado: estadoLocal,
    };
  }

  public async configurarAtuadores(parametros: { corLuz?: string; somSpeaker?: string; textoDisplay?: string }) {
    estadoLocal.overrideManualAte = Date.now() + 15000;
    if (parametros.corLuz) {
      estadoLocal.modoCalmaAtivo = parametros.corLuz.toLowerCase().includes('azul');
      estadoLocal.iluminacao = parametros.corLuz;
    }
    if (parametros.somSpeaker) {
      estadoLocal.smartSpeaker = parametros.somSpeaker;
    }
    if (parametros.textoDisplay) {
      estadoLocal.displayPorta = parametros.textoDisplay;
    }
    estadoLocal.ultimaAtualizacao = new Date().toISOString();
    await salvarReplicaMongoDB('INVOCACAO_METODO', `Configuração de atuadores via ${CONTROLLER_ID}`);

    return {
      sucesso: true,
      metodoInvocado: 'configurarAtuadores()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: `Atuadores configurados e persistidos no MongoDB 3!`,
      estado: estadoLocal,
    };
  }
}

// Instancia o objeto distribuído da Réplica 3
const objetoControlador = new ControladorProcessoSala3();

// Inicia conexão com o MongoDB 3
inicializarMongoDB();

// Conecta ao Broker MQTT para telemetria
const mqttClient = mqtt.connect(BROKER_URL, {
  clientId: `${CONTROLLER_ID}_${Math.random().toString(16).slice(2, 6)}`,
});

// Assina tópicos de telemetria
mqttClient.on('connect', () => {
  console.log(`[${CONTROLLER_ID}] Conectado ao Broker MQTT em ${BROKER_URL}`);
  const topicosAssinados = [
    'clinica/sala1/ruido',
    'clinica/sala1/bpm',
    'clinica/sala1/presenca',
    'clinica/sala1/porta',
    'clinica/recepcao/checkin',
  ];
  mqttClient.subscribe(topicosAssinados, { qos: 0 });
});

// Atualiza o estado em memória local a partir da telemetria
mqttClient.on('message', (topic, message) => {
  try {
    const dados = JSON.parse(message.toString());
    const ts = dados.timestamp || new Date().toISOString();

    if (topic === 'clinica/sala1/ruido' && typeof dados.db === 'number') {
      estadoLocal.ruidoDb = dados.db;
      estadoLocal.ultimaAtualizacao = ts;
    } else if (topic === 'clinica/sala1/bpm' && typeof dados.bpm === 'number') {
      estadoLocal.bpm = dados.bpm;
      estadoLocal.ultimaAtualizacao = ts;
    } else if (topic === 'clinica/recepcao/checkin') {
      const { acao, nome, musica, cor } = dados;
      if (acao === 'entrar_fila') {
        const nomeLimpo = (nome || '').trim();
        if (!estadoLocal.presenca) {
          estadoLocal.presenca = true;
          estadoLocal.tagId = nomeLimpo;
          estadoLocal.musicaFavorita = musica || 'Rock';
          estadoLocal.corFavorita = cor || 'Azul';
        }
      }
    }
  } catch {
    // Trata erros silenciosamente
  }
});

// Instancia o servidor gRPC para expor serviços na porta 3003
const grpcServer = new grpc.Server();

// Registra os métodos do serviço externo MiddlewareClinico
grpcServer.addService(diverterapiaProto.MiddlewareClinico.service, {
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
      });
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err?.message });
    }
  },

  InvocarMetodo: async (call: any, callback: any) => {
    try {
      const { metodo, origem, parametros } = call.request;
      if (metodo === 'configurarAtuadores') {
        const resultado = await objetoControlador.configurarAtuadores(parametros || {});
        callback(null, {
          sucesso: resultado.sucesso,
          metodoInvocado: resultado.metodoInvocado,
          processadoPor: resultado.processadoPor,
          porta: resultado.porta,
          mensagem: resultado.mensagem,
          estado: sanitizarEstadoParaGrpc(resultado.estado),
        });
      } else {
        const resultado = await objetoControlador.ativarModoCalmaManual(origem || 'Cliente');
        callback(null, {
          sucesso: resultado.sucesso,
          metodoInvocado: resultado.metodoInvocado,
          processadoPor: resultado.processadoPor,
          porta: resultado.porta,
          mensagem: resultado.mensagem,
          estado: sanitizarEstadoParaGrpc(resultado.estado),
        });
      }
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err?.message });
    }
  },

  // Alterna o estado da injeção de falha bizantina
  ToggleBizantino: async (_call: any, callback: any) => {
    simularFalhaBizantina = !simularFalhaBizantina;
    console.log(`⚠️ [${CONTROLLER_ID}] Modo Falha Bizantina alterado via gRPC para: ${simularFalhaBizantina ? 'ATIVO' : 'INATIVO'}`);
    callback(null, {
      sucesso: true,
      metodoInvocado: 'ToggleBizantino()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: `Simulação de Falha Bizantina alterada para: ${simularFalhaBizantina ? 'ATIVO' : 'INATIVO'}`,
      estado: sanitizarEstadoParaGrpc(estadoLocal),
    });
  },
});

// Registra o serviço ConsensoInterno para colaboração com o Líder
grpcServer.addService(diverterapiaProto.ConsensoInterno.service, {
  // Handler RPC VotarEstado: adulteração proposital para testar descarte pelo Quorum do Líder
  VotarEstado: async (call: any, callback: any) => {
    const { tipoEvento } = call.request;

    // Se a simulação bizantina estiver ativa, corrompe intencionalmente a resposta
    if (simularFalhaBizantina) {
      const estadoAdulterado = {
        ...estadoLocal,
        ruidoDb: 999,
        bpm: 250,
        presenca: !estadoLocal.presenca,
        tagId: 'DADO_ADULTERADO_BIZANTINO',
        musicaFavorita: 'sirene-descalibrada',
        corFavorita: 'vermelho-bizantino',
        iluminacao: 'Vermelho / Alerta Falso',
        smartSpeaker: 'Sirene Descalibrada',
        displayPorta: '> ERRO BIZANTINO / INVASÃO DETECTADA',
        modoCalmaAtivo: !estadoLocal.modoCalmaAtivo,
      };

      console.log(`⚠️ [${CONTROLLER_ID}] Voto BIZANTINO ADULTERADO emitido ao Líder (Ruído: 999dB, BPM: 250, Evento: ${tipoEvento})`);

      callback(null, {
        controlador: CONTROLLER_ID,
        porta: GRPC_PORT,
        aprova: false,
        estadoVotado: sanitizarEstadoParaGrpc(estadoAdulterado),
        justificativa: 'FALHA_BIZANTINA: Dados adulterados deliberadamente para validar o Quorum 2x1 do Líder',
      });
    } else {
      // Se a simulação bizantina estiver inativa, vota de forma íntegra e honesta
      console.log(`✅ [${CONTROLLER_ID}] Voto ÍNTEGRO emitido ao Líder (Modo Honesto, Evento: ${tipoEvento})`);

      callback(null, {
        controlador: CONTROLLER_ID,
        porta: GRPC_PORT,
        aprova: true,
        estadoVotado: sanitizarEstadoParaGrpc(estadoLocal),
        justificativa: `Voto íntegro e honesto emitido pela Réplica 3 (Porta ${GRPC_PORT})`,
      });
    }
  },

  // Handler RPC EfetivarEstado: persiste o estado validado pelo Quorum do Líder no MongoDB 3
  EfetivarEstado: async (call: any, callback: any) => {
    try {
      const { tipo, descricao, estadoValidado } = call.request;
      if (estadoValidado) {
        Object.assign(estadoLocal, estadoValidado);
      }
      await salvarReplicaMongoDB(tipo || 'CONSENSO', `${descricao} [Efetivado via Líder]`);
      callback(null, {
        sucesso: true,
        metodoInvocado: 'EfetivarEstado()',
        processadoPor: CONTROLLER_ID,
        porta: GRPC_PORT,
        mensagem: `Estado validado pelo Quorum persistido no MongoDB 3!`,
        estado: sanitizarEstadoParaGrpc(estadoLocal),
      });
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err?.message || 'Erro ao efetivar' });
    }
  },
});

// Vincula o servidor gRPC na porta 3003
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
    console.log(`   -> Banco de Dados: ${MONGO_URI}`);
    console.log(`   -> Simulação Bizantina: ${simularFalhaBizantina ? 'ATIVA' : 'INATIVA'}`);
    console.log(`=====================================================`);
  }
);
