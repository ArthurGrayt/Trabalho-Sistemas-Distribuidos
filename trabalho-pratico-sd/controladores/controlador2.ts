// Importa o módulo gRPC nativo para comunicação de alto desempenho via chamadas RPC
import * as grpc from '@grpc/grpc-js';
// Importa o proto-loader para carregar dinamicamente o arquivo de definição de serviço Protobuf
import * as protoLoader from '@grpc/proto-loader';
// Importa o módulo nativo 'path' para resolver o caminho absoluto do arquivo .proto
import path from 'path';
// Importa a biblioteca 'mqtt' para conectar o controlador ao barramento Publish/Subscribe
import mqtt from 'mqtt';
// Importa o 'mongoose' para modelagem e persistência de dados na instância MongoDB 2
import mongoose, { Schema, Document } from 'mongoose';

// Define a porta gRPC exclusiva do Controlador de Processo 2 (3002) - Réplica Honesta
const GRPC_PORT = 3002;
// Define o identificador único deste Controlador de Processo (Réplica de Failover)
const CONTROLLER_ID = 'controlador-2';
// Define a URL do Broker MQTT local na porta 1883
const BROKER_URL = 'mqtt://127.0.0.1:1883';
// Define a URI de conexão exclusiva com a instância MongoDB 2 na porta 27018
const MONGO_URI = 'mongodb://127.0.0.1:27018/diverterapia';
// Define a chave única do documento da Sala 1 na coleção do MongoDB
const SALA_DOC_ID = 'sala-1';

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

// Schema principal do Mongoose associado à coleção 'estados_sala' na instância MongoDB 2
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

// Cria o Model Mongoose associado à coleção 'estados_sala' na instância MongoDB 2
const EstadoSalaModel = mongoose.model<EstadoSalaDocument>('EstadoSala', EstadoSalaSchema, 'estados_sala');

// Inicializa o estado em memória espelhado com o documento do MongoDB 2
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

// Função assíncrona que persiste o estado atual na instância MongoDB 2
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
    console.error(`[${CONTROLLER_ID}] Erro ao persistir no MongoDB 2 (${MONGO_URI}):`, err);
  }
}

// Função assíncrona que lê o estado diretamente do MongoDB 2
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
      console.error(`[${CONTROLLER_ID}] Erro ao ler estado no MongoDB 2:`, err);
    }
  }
  return estadoLocal;
}

// Inicializa a conexão com o MongoDB 2
async function inicializarMongoDB(): Promise<void> {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`[${CONTROLLER_ID}] Conectado com sucesso ao MongoDB 2 em ${MONGO_URI}`);
    const docExistente = await EstadoSalaModel.findOne({ salaId: SALA_DOC_ID }).lean();
    if (docExistente) {
      await carregarEstadoDoMongoDB();
      console.log(`[${CONTROLLER_ID}] Estado recuperado do MongoDB 2.`);
    } else {
      await salvarReplicaMongoDB('INICIALIZACAO', `${CONTROLLER_ID} inicializou o documento no MongoDB 2`);
    }
  } catch (err) {
    console.error(`[${CONTROLLER_ID}] Erro ao conectar no MongoDB 2 (${MONGO_URI}):`, err);
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

// Classe que implementa o Objeto Distribuído da Réplica 2
class ControladorProcessoSala2 {
  public async obterStatus() {
    const estadoAtual = await carregarEstadoDoMongoDB();
    return {
      controlador: CONTROLLER_ID,
      porta: GRPC_PORT,
      armazenamentoId: 'MongoDB 2 (mongodb://127.0.0.1:27018/diverterapia)',
      integridade: 'HONESTO',
      estado: estadoAtual,
    };
  }

  public async ativarModoCalmaManual(origemCliente: string) {
    estadoLocal.overrideManualAte = Date.now() + 15000;
    estadoLocal.iluminacao = 'Azul / Calmante';
    estadoLocal.smartSpeaker = 'Frequência Calmante (Ruído Branco)';
    estadoLocal.displayPorta = '> Regulação em Curso (Não Entre)';
    estadoLocal.modoCalmaAtivo = true;
    estadoLocal.ultimaAtualizacao = new Date().toISOString();
    await salvarReplicaMongoDB('INVOCACAO_METODO', `Modo Calma Manual via Failover (${origemCliente})`);

    return {
      sucesso: true,
      metodoInvocado: 'ativarModoCalmaManual()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      armazenamentoAtualizado: 'MongoDB 2 (27018)',
      mensagem: `Método executado e persistido no MongoDB 2 pelo ${CONTROLLER_ID}!`,
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
      mensagem: `Atuadores configurados e persistidos no MongoDB 2!`,
      estado: estadoLocal,
    };
  }
}

// Instancia o objeto distribuído da Réplica 2
const objetoControlador = new ControladorProcessoSala2();

// Inicia conexão com o MongoDB 2
inicializarMongoDB();

// Conecta ao Broker MQTT para manter espelhamento de telemetria
const mqttClient = mqtt.connect(BROKER_URL, {
  clientId: `${CONTROLLER_ID}_${Math.random().toString(16).slice(2, 6)}`,
});

// Assina os mesmos tópicos de telemetria para calcular seu voto honesto
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

// Atualiza o estado em memória local a partir da telemetria (para fundamentar o voto)
mqttClient.on('message', (topic, message) => {
  try {
    const dados = JSON.parse(message.toString());
    const ts = dados.timestamp || new Date().toISOString();

    if (topic === 'clinica/sala1/ruido' && typeof dados.db === 'number') {
      estadoLocal.ruidoDb = dados.db;
      estadoLocal.ultimaAtualizacao = ts;
      if (estadoLocal.ruidoDb > 85 || estadoLocal.bpm > 120) {
        estadoLocal.modoCalmaAtivo = true;
        estadoLocal.iluminacao = 'Azul / Calmante';
        estadoLocal.smartSpeaker = 'Frequência Calmante (Ruído Branco)';
        estadoLocal.displayPorta = '> Regulação em Curso (Não Entre)';
      }
    } else if (topic === 'clinica/sala1/bpm' && typeof dados.bpm === 'number') {
      estadoLocal.bpm = dados.bpm;
      estadoLocal.ultimaAtualizacao = ts;
      if (estadoLocal.ruidoDb > 85 || estadoLocal.bpm > 120) {
        estadoLocal.modoCalmaAtivo = true;
        estadoLocal.iluminacao = 'Azul / Calmante';
        estadoLocal.smartSpeaker = 'Frequência Calmante (Ruído Branco)';
        estadoLocal.displayPorta = '> Regulação em Curso (Não Entre)';
      }
    } else if (topic === 'clinica/recepcao/checkin') {
      const { acao, nome, musica, cor } = dados;
      if (acao === 'entrar_fila') {
        const nomeLimpo = (nome || '').trim();
        if (!estadoLocal.presenca) {
          estadoLocal.presenca = true;
          estadoLocal.tagId = nomeLimpo;
          estadoLocal.musicaFavorita = musica || 'Rock';
          estadoLocal.corFavorita = cor || 'Azul';
        } else if (estadoLocal.tagId.toLowerCase() !== nomeLimpo.toLowerCase()) {
          const index = estadoLocal.filaEspera.findIndex((p) => p.nome.toLowerCase() === nomeLimpo.toLowerCase());
          if (index === -1) {
            estadoLocal.filaEspera.push({
              nome: nomeLimpo,
              musica: musica || 'Rock',
              cor: cor || 'Azul',
              horario: new Date().toLocaleTimeString('pt-BR'),
            });
          }
        }
      }
    }
  } catch {
    // Trata mensagens inválidas silenciosamente
  }
});

// Instancia o servidor gRPC para expor serviços na porta 3002
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

  ToggleBizantino: async (_call: any, callback: any) => {
    callback(null, {
      sucesso: true,
      metodoInvocado: 'ToggleBizantino()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: 'Controlador 2 é Réplica Honesta.',
      estado: sanitizarEstadoParaGrpc(estadoLocal),
    });
  },
});

// Registra o serviço ConsensoInterno para colaboração com o Líder
grpcServer.addService(diverterapiaProto.ConsensoInterno.service, {
  // Emite voto honesto e íntegro baseado na telemetria calculada
  VotarEstado: async (call: any, callback: any) => {
    const { tipoEvento, estadoCandidato } = call.request;
    // Sincroniza parâmetros candidatos caso pertinentes
    if (estadoCandidato && tipoEvento === 'INVOCACAO_METODO') {
      estadoLocal.iluminacao = estadoCandidato.iluminacao;
      estadoLocal.smartSpeaker = estadoCandidato.smartSpeaker;
      estadoLocal.displayPorta = estadoCandidato.displayPorta;
      estadoLocal.modoCalmaAtivo = estadoCandidato.modoCalmaAtivo;
    }
    console.log(`🗳️ [${CONTROLLER_ID}] Voto ÍNTEGRO emitido ao Líder sobre evento: ${tipoEvento}`);
    callback(null, {
      controlador: CONTROLLER_ID,
      porta: GRPC_PORT,
      aprova: true,
      estadoVotado: sanitizarEstadoParaGrpc(estadoLocal),
      justificativa: `Voto íntegro e favorável emitido pela Réplica Honesta 2 (Porta ${GRPC_PORT})`,
    });
  },

  // Efetiva o estado validado pelo Quorum e grava no MongoDB 2
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
        mensagem: `Estado validado pelo Quorum persistido no MongoDB 2!`,
        estado: sanitizarEstadoParaGrpc(estadoLocal),
      });
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err?.message || 'Erro ao efetivar' });
    }
  },
});

// Vincula o servidor gRPC na porta 3002
grpcServer.bindAsync(
  `0.0.0.0:${GRPC_PORT}`,
  grpc.ServerCredentials.createInsecure(),
  (err, port) => {
    if (err) {
      console.error(`[${CONTROLLER_ID}] Erro ao vincular porta gRPC ${GRPC_PORT}:`, err);
      return;
    }
    console.log(`=====================================================`);
    console.log(`[MIDDLEWARE gRPC] ${CONTROLLER_ID} (RÉPLICA HONESTA) ativo na porta ${port}`);
    console.log(`   -> Banco de Dados: ${MONGO_URI}`);
    console.log(`   -> Serviço de Consenso: ConsensoInterno Ativo`);
    console.log(`=====================================================`);
  }
);
