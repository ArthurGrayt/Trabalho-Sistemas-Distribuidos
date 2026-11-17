// Importa o módulo gRPC nativo para comunicação de alto desempenho via chamadas RPC
import * as grpc from '@grpc/grpc-js';
// Importa o proto-loader para carregar dinamicamente o arquivo de definição de serviço Protobuf
import * as protoLoader from '@grpc/proto-loader';
// Importa o módulo nativo 'path' para resolver o caminho absoluto do arquivo .proto
import path from 'path';
// Importa a biblioteca 'mqtt' para conectar o controlador ao barramento Publish/Subscribe
import mqtt from 'mqtt';
// Importa o 'mongoose' para modelagem e persistência de dados na instância MongoDB 1
import mongoose, { Schema, Document } from 'mongoose';

// Define a porta gRPC exclusiva do Controlador de Processo 1 (3001) - Nó Líder
const GRPC_PORT = 3001;
// Define o identificador único deste Controlador de Processo
const CONTROLLER_ID = 'controlador-1';
// Define a URL do Broker MQTT local na porta 1883
const BROKER_URL = 'mqtt://127.0.0.1:1883';
// Define a URI de conexão exclusiva com a instância MongoDB 1 na porta 27017
const MONGO_URI = 'mongodb://127.0.0.1:27017/diverterapia';
// Define a chave única do documento da Sala 1 na coleção do MongoDB
const SALA_DOC_ID = 'sala-1';

// Resolve o caminho absoluto do contrato Protobuf compartilhado
const PROTO_PATH = path.resolve(__dirname, '../proto/diverterapia.proto');

// Carrega a definição do contrato .proto utilizando o proto-loader com opções tipadas
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  // Preserva os nomes dos campos em camelCase definidos no .proto
  keepCase: true,
  // Representa inteiros de 64 bits como Strings para compatibilidade total
  longs: String,
  // Trata enums como strings legíveis
  enums: String,
  // Define valores padrão para campos não preenchidos
  defaults: true,
  // Suporta estruturas do tipo oneof
  oneofs: true,
});

// Extrai o pacote 'diverterapia' a partir da definição carregada do gRPC
const diverterapiaProto = (grpc.loadPackageDefinition(packageDefinition) as any).diverterapia;

// Interface que representa um registro histórico persistido no documento do MongoDB
interface RegistroHistorico {
  // Identificador temporal do evento em formato ISO 8601
  horario: string;
  // Tipo do evento registrado (TELEMETRIA, REGRA_AUTOMATICA, INVOCACAO_METODO, FILA, CONSENSO)
  tipo: string;
  // Descrição detalhada da decisão ou mudança de estado
  descricao: string;
}

// Interface para um item na Fila de Espera Distribuída de pacientes
interface ItemFilaEspera {
  // Nome da criança cadastrada no smartphone
  nome: string;
  // Estilo musical selecionado pelo aluno
  musica: string;
  // Cor de iluminação favorita selecionada
  cor: string;
  // Horário em que o check-in foi realizado
  horario: string;
}

// Interface que modela o Objeto Distribuído da Sala 1 gerenciado pelo Middleware
interface EstadoSala {
  // Último nível de ruído em decibéis (dB) recebido em tempo real do Simulador Mobile
  ruidoDb: number;
  // Última frequência cardíaca (BPM) recebida em tempo real do Simulador Mobile
  bpm: number;
  // Presença de paciente na Sala 1
  presenca: boolean;
  // Nome do paciente atualmente em atendimento na Sala 1
  tagId: string;
  // Música favorita do paciente atual
  musicaFavorita: string;
  // Cor favorita para iluminação da sala
  corFavorita: string;
  // Estado atual do Atuador de Iluminação RGB
  iluminacao: string;
  // Estado atual do Atuador Smart Speaker
  smartSpeaker: string;
  // Mensagem exibida no Atuador Display de Porta
  displayPorta: string;
  // Indica se a Regulação Sensorial está ativa na clínica
  modoCalmaAtivo: boolean;
  // Indica até quando o acionamento manual tem prioridade sobre a automação
  overrideManualAte: number;
  // Fila de Espera de pacientes aguardando a sala desocupar
  filaEspera: ItemFilaEspera[];
  // Timestamp ISO da última atualização sincronizada
  ultimaAtualizacao: string;
  // Lista de eventos gravados na réplica do MongoDB deste controlador
  historico: RegistroHistorico[];
}

// Interface do documento Mongoose combinando EstadoSala e Document
interface EstadoSalaDocument extends EstadoSala, Document {
  // Identificador único da sala no banco de dados
  salaId: string;
}

// Sub-schema do Mongoose para os itens da fila de espera
const ItemFilaSchema = new Schema<ItemFilaEspera>(
  {
    // Campo nome do paciente na fila
    nome: { type: String, required: true },
    // Campo estilo musical favorito
    musica: { type: String, required: true },
    // Campo cor favorita para iluminação
    cor: { type: String, required: true },
    // Campo horário de entrada na fila
    horario: { type: String, required: true },
  },
  // Desativa geração de _id individual para subdocumentos da fila
  { _id: false }
);

// Sub-schema do Mongoose para os registros de auditoria histórica
const RegistroHistoricoSchema = new Schema<RegistroHistorico>(
  {
    // Campo de data/hora ISO do evento
    horario: { type: String, required: true },
    // Campo de categoria do evento
    tipo: { type: String, required: true },
    // Campo descritivo do evento
    descricao: { type: String, required: true },
  },
  // Desativa geração de _id individual para subdocumentos do histórico
  { _id: false }
);

// Schema principal do Mongoose que armazena exatamente a estrutura EstadoSala no MongoDB
const EstadoSalaSchema = new Schema<EstadoSalaDocument>(
  {
    // Identificador fixo da sala ('sala-1') para garantir documento único na coleção
    salaId: { type: String, required: true, unique: true, default: SALA_DOC_ID },
    // Nível de ruído acústico em dB
    ruidoDb: { type: Number, required: true, default: 62 },
    // Frequência cardíaca em BPM
    bpm: { type: Number, required: true, default: 80 },
    // Booleano indicando presença de paciente na sala
    presenca: { type: Boolean, required: true, default: false },
    // Identificação ou nome do paciente atual
    tagId: { type: String, required: true, default: 'Nenhum paciente' },
    // Estilo musical favorito do paciente
    musicaFavorita: { type: String, required: true, default: 'Aguardando paciente' },
    // Cor favorita selecionada pelo paciente
    corFavorita: { type: String, required: true, default: 'Branco' },
    // Estado atual do atuador de iluminação
    iluminacao: { type: String, required: true, default: 'Branca / Alto Contraste' },
    // Estado atual do atuador Smart Speaker
    smartSpeaker: { type: String, required: true, default: 'Aguardando paciente' },
    // Texto exibido no atuador Display da Porta
    displayPorta: { type: String, required: true, default: '> Sala 1 - Livre' },
    // Flag de ativação do protocolo de Regulação Sensorial
    modoCalmaAtivo: { type: Boolean, required: true, default: false },
    // Timestamp numérico para prioridade de comandos manuais
    overrideManualAte: { type: Number, required: true, default: 0 },
    // Array contendo a fila de espera de pacientes
    filaEspera: { type: [ItemFilaSchema], default: [] },
    // Timestamp ISO da última modificação de estado
    ultimaAtualizacao: { type: String, required: true, default: () => new Date().toISOString() },
    // Array com os últimos registros históricos de auditoria
    historico: { type: [RegistroHistoricoSchema], default: [] },
  },
  // Desativa o versionKey (__v) para manter o JSON limpo
  { versionKey: false }
);

// Cria o Model Mongoose associado à coleção 'estados_sala' na instância MongoDB 1
const EstadoSalaModel = mongoose.model<EstadoSalaDocument>('EstadoSala', EstadoSalaSchema, 'estados_sala');

// Inicializa o estado em memória espelhado com o documento do MongoDB 1
const estadoLocal: EstadoSala = {
  // Ruído inicial em repouso (62 dB)
  ruidoDb: 62,
  // Batimentos cardíacos normais (80 BPM)
  bpm: 80,
  // Sala inicialmente livre
  presenca: false,
  // Identificador indicando ausência de paciente
  tagId: 'Nenhum paciente',
  // Trilha inicial ociosa
  musicaFavorita: 'Aguardando paciente',
  // Cor inicial padrão
  corFavorita: 'Branco',
  // Iluminação inicial de Foco Dirigido
  iluminacao: 'Branca / Alto Contraste',
  // Smart Speaker ocioso
  smartSpeaker: 'Aguardando paciente',
  // Visor da Porta livre
  displayPorta: '> Sala 1 - Livre',
  // Regulação sensorial inativa
  modoCalmaAtivo: false,
  // Sem override manual inicial
  overrideManualAte: 0,
  // Fila de espera inicialmente vazia
  filaEspera: [],
  // Data e hora de inicialização
  ultimaAtualizacao: new Date().toISOString(),
  // Histórico inicial vazio
  historico: [],
};

// Função assíncrona que persiste o estado atual na instância MongoDB 1
async function salvarReplicaMongoDB(tipo: string, descricao: string): Promise<void> {
  // Cria um novo registro de auditoria com timestamp atual
  const novoRegistro: RegistroHistorico = {
    // Data e hora formatada em ISO
    horario: new Date().toISOString(),
    // Categoria da operação
    tipo,
    // Detalhe do evento
    descricao,
  };
  // Adiciona o evento no topo do histórico mantendo os últimos 15 registros
  estadoLocal.historico = [novoRegistro, ...estadoLocal.historico.slice(0, 14)];

  // Verifica se a conexão com o MongoDB está ativa antes de executar o upsert
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  // Grava o documento no MongoDB 1 via findOneAndUpdate com upsert
  try {
    await EstadoSalaModel.findOneAndUpdate(
      { salaId: SALA_DOC_ID },
      { $set: { salaId: SALA_DOC_ID, ...estadoLocal } },
      { upsert: true, new: true }
    ).lean();
  } catch (err) {
    console.error(`[${CONTROLLER_ID}] Erro ao persistir no MongoDB 1 (${MONGO_URI}):`, err);
  }
}

// Função assíncrona que lê o estado diretamente do MongoDB 1
async function carregarEstadoDoMongoDB(): Promise<EstadoSala> {
  // Verifica se a conexão com o MongoDB 1 está estabelecida
  if (mongoose.connection.readyState === 1) {
    try {
      // Busca o documento da Sala 1 no MongoDB 1
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
      console.error(`[${CONTROLLER_ID}] Erro ao ler estado no MongoDB 1:`, err);
    }
  }
  return estadoLocal;
}

// Inicializa a conexão com o MongoDB 1 e garante a criação do documento inicial
async function inicializarMongoDB(): Promise<void> {
  try {
    // Conecta à instância MongoDB 1 na porta 27017
    await mongoose.connect(MONGO_URI);
    console.log(`[${CONTROLLER_ID}] Conectado com sucesso ao MongoDB 1 em ${MONGO_URI}`);
    const docExistente = await EstadoSalaModel.findOne({ salaId: SALA_DOC_ID }).lean();
    if (docExistente) {
      await carregarEstadoDoMongoDB();
      console.log(`[${CONTROLLER_ID}] Estado recuperado do MongoDB 1.`);
    } else {
      await salvarReplicaMongoDB('INICIALIZACAO', `${CONTROLLER_ID} inicializou o documento no MongoDB 1`);
    }
  } catch (err) {
    console.error(`[${CONTROLLER_ID}] Erro ao conectar no MongoDB 1 (${MONGO_URI}):`, err);
  }
}

// Função auxiliar de conversão para sanitizar o documento BSON do MongoDB e mapear para a mensagem gRPC
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

// Clientes gRPC internos para comunicação com as réplicas 2 e 3
const clientConsenso2 = new diverterapiaProto.ConsensoInterno('127.0.0.1:3002', grpc.credentials.createInsecure());
const clientConsenso3 = new diverterapiaProto.ConsensoInterno('127.0.0.1:3003', grpc.credentials.createInsecure());

// Função comparadora para validação de votos: identifica discrepâncias ou corrupção bizantina
function compararEstados(candidato: EstadoSala, votado: any): boolean {
  // Rejeita caso o voto não tenha vindo completo
  if (!candidato || !votado) return false;

  // Rejeita dados corrompidos com assinaturas bizantinas
  const tagVotado = String(votado.tagId || '');
  if (tagVotado.includes('BIZANTINO') || tagVotado.includes('HACKED')) {
    return false;
  }

  // Compara ruído acústico com tolerância de até 5 dB (rejeita 999 dB)
  const difRuido = Math.abs(Number(candidato.ruidoDb || 0) - Number(votado.ruidoDb || 0));
  if (difRuido > 5) {
    return false;
  }

  // Compara batimentos cardíacos com tolerância de até 5 BPM (rejeita 250 BPM)
  const difBpm = Math.abs(Number(candidato.bpm || 0) - Number(votado.bpm || 0));
  if (difBpm > 5) {
    return false;
  }

  // Compara presença de paciente
  if (Boolean(candidato.presenca) !== Boolean(votado.presenca)) {
    return false;
  }

  // Compara ativação de regulação sensorial
  if (Boolean(candidato.modoCalmaAtivo) !== Boolean(votado.modoCalmaAtivo)) {
    return false;
  }

  // Voto validado como íntegro e concordante
  return true;
}

// Dispara pedido de voto individual a uma réplica via gRPC
function pedirVoto(client: any, porta: number, tipoEvento: string, candidato: EstadoSala): Promise<any> {
  return new Promise((resolve, reject) => {
    // Define prazo limite de 800ms para voto
    const deadline = new Date(Date.now() + 800);
    // Invoca VotarEstado na réplica
    client.VotarEstado(
      {
        liderId: CONTROLLER_ID,
        tipoEvento,
        estadoCandidato: sanitizarEstadoParaGrpc(candidato),
      },
      new grpc.Metadata(),
      { deadline },
      (err: any, response: any) => {
        if (err) {
          reject(err);
        } else {
          resolve({ ...response, porta });
        }
      }
    );
  });
}

// Dispara ordem de efetivação e persistência do estado validado nas réplicas 2 e 3
function ordenarEfetivacaoNasReplicas(tipoEvento: string, descricao: string, estadoValidado: EstadoSala): void {
  // Prepara payload de efetivação
  const payload = {
    liderId: CONTROLLER_ID,
    tipo: tipoEvento,
    descricao,
    estadoValidado: sanitizarEstadoParaGrpc(estadoValidado),
  };
  // Define deadline para efetivação
  const deadline = new Date(Date.now() + 1000);

  // Efetiva na Réplica 2
  clientConsenso2.EfetivarEstado(payload, new grpc.Metadata(), { deadline }, (err: any) => {
    if (err) console.warn(`[${CONTROLLER_ID}] Réplica 2 não confirmou efetivação:`, err.message);
  });

  // Efetiva na Réplica 3
  clientConsenso3.EfetivarEstado(payload, new grpc.Metadata(), { deadline }, (err: any) => {
    if (err) console.warn(`[${CONTROLLER_ID}] Réplica 3 não confirmou efetivação:`, err.message);
  });
}

// Função de consenso do Líder (Quorum 2x1): valida ANTES de gravar no MongoDB e acionar atuadores
async function executarQuorumLider(
  tipoEvento: string,
  descricao: string,
  candidato: EstadoSala,
  publicarAtuadores: boolean = false
): Promise<boolean> {
  // Votos concordantes inicializados em 1 (o voto do próprio Líder em seu estado candidato)
  let votosConcordantes = 1;
  // Detalhes da auditoria de votação
  const detalhesVotos: string[] = [`Líder (Porta ${GRPC_PORT}): APROVADO`];

  // Dispara consultas de voto em paralelo para as réplicas 2 e 3
  const promessasVoto = [
    pedirVoto(clientConsenso2, 3002, tipoEvento, candidato),
    pedirVoto(clientConsenso3, 3003, tipoEvento, candidato),
  ];

  // Aguarda as respostas de voto
  const resultadosVotos = await Promise.allSettled(promessasVoto);

  // Analisa o voto da Réplica 2 (porta 3002)
  const res2 = resultadosVotos[0];
  if (res2.status === 'fulfilled') {
    const voto2 = res2.value;
    if (voto2.aprova && compararEstados(candidato, voto2.estadoVotado)) {
      votosConcordantes++;
      detalhesVotos.push(`Réplica 2 (:3002): APROVADO (Voto Íntegro)`);
    } else {
      detalhesVotos.push(`Réplica 2 (:3002): REJEITADO (Divergência)`);
    }
  } else {
    detalhesVotos.push(`Réplica 2 (:3002): OFFLINE`);
  }

  // Analisa o voto da Réplica 3 (porta 3003)
  const res3 = resultadosVotos[1];
  if (res3.status === 'fulfilled') {
    const voto3 = res3.value;
    if (voto3.aprova && compararEstados(candidato, voto3.estadoVotado)) {
      votosConcordantes++;
      detalhesVotos.push(`Réplica 3 (:3003): APROVADO (Voto Íntegro)`);
    } else {
      detalhesVotos.push(
        `Réplica 3 (:3003): DESCARTADO POR FALHA BIZANTINA (Ruído: ${voto3?.estadoVotado?.ruidoDb}dB, BPM: ${voto3?.estadoVotado?.bpm})`
      );
    }
  } else {
    detalhesVotos.push(`Réplica 3 (:3003): OFFLINE`);
  }

  // Verifica se atingiu Quorum de 2 em 3 votos
  if (votosConcordantes >= 2) {
    console.log(`⚖️ [${CONTROLLER_ID}] QUORUM 2x1 ALCANÇADO (${votosConcordantes}/3 votos): [${detalhesVotos.join(' | ')}]`);

    // Sincroniza o estado em memória local com o candidato validado
    Object.assign(estadoLocal, candidato);

    // Persiste o estado aprovado no MongoDB 1 do Líder
    await salvarReplicaMongoDB(tipoEvento, `${descricao} [Consenso Quorum 2x1 Aprovado]`);

    // Publica comandos nos atuadores físicos se solicitado
    if (publicarAtuadores) {
      mqttClient.publish('clinica/sala1/comando/luz', JSON.stringify({ cor: estadoLocal.iluminacao, origem: CONTROLLER_ID }), { qos: 0 });
      mqttClient.publish('clinica/sala1/comando/som', JSON.stringify({ som: estadoLocal.smartSpeaker, origem: CONTROLLER_ID }), { qos: 0 });
      mqttClient.publish('clinica/sala1/comando/display', JSON.stringify({ mensagem: estadoLocal.displayPorta, origem: CONTROLLER_ID }), { qos: 0 });
    }

    // Ordena que as réplicas 2 e 3 gravem o estado validado em seus respectivos MongoDBs
    ordenarEfetivacaoNasReplicas(tipoEvento, descricao, estadoLocal);
    return true;
  } else {
    console.warn(`🚨 [${CONTROLLER_ID}] FALHA DE QUORUM (${votosConcordantes}/3 votos). Candidato descartado. [${detalhesVotos.join(' | ')}]`);
    return false;
  }
}

// Classe que implementa o Objeto Distribuído do Controlador Líder
class ControladorProcessoSala1 {
  // Retorna o status atual lido diretamente da réplica MongoDB 1
  public async obterStatus() {
    const estadoAtual = await carregarEstadoDoMongoDB();
    return {
      controlador: CONTROLLER_ID,
      porta: GRPC_PORT,
      armazenamentoId: 'MongoDB 1 (mongodb://127.0.0.1:27017/diverterapia)',
      integridade: 'LIDER_HONESTO',
      estado: estadoAtual,
    };
  }

  // Ativa manualmente a Regulação Sensorial com Quorum 2x1 prévio
  public async ativarModoCalmaManual(origemCliente: string) {
    // Clona o estado atual para criar a proposta candidata
    const candidato: EstadoSala = JSON.parse(JSON.stringify(estadoLocal));
    candidato.overrideManualAte = Date.now() + 15000;
    candidato.iluminacao = 'Azul / Calmante';
    candidato.smartSpeaker = 'Frequência Calmante (Ruído Branco)';
    candidato.displayPorta = '> Regulação em Curso (Não Entre)';
    candidato.modoCalmaAtivo = true;
    candidato.ultimaAtualizacao = new Date().toISOString();

    // Submete ao Quorum antes de persistir
    const aprovado = await executarQuorumLider(
      'INVOCACAO_METODO',
      `Regulação Sensorial Manual acionada por ${origemCliente}`,
      candidato,
      true
    );

    return {
      sucesso: aprovado,
      metodoInvocado: 'ativarModoCalmaManual()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      armazenamentoAtualizado: 'MongoDB 1 (27017)',
      mensagem: aprovado
        ? `Método validado por Quorum 2x1 e gravado no MongoDB pelo Líder ${CONTROLLER_ID}!`
        : `Consenso rejeitado: Quorum 2x1 não foi atingido.`,
      estado: estadoLocal,
    };
  }

  // Configura atuadores físicos com Quorum 2x1 prévio
  public async configurarAtuadores(parametros: { corLuz?: string; somSpeaker?: string; textoDisplay?: string }) {
    const candidato: EstadoSala = JSON.parse(JSON.stringify(estadoLocal));
    candidato.overrideManualAte = Date.now() + 15000;

    if (parametros.corLuz) {
      candidato.modoCalmaAtivo = parametros.corLuz.toLowerCase().includes('azul');
      candidato.iluminacao = parametros.corLuz;
    }
    if (parametros.somSpeaker) {
      candidato.smartSpeaker = parametros.somSpeaker;
    }
    if (parametros.textoDisplay) {
      candidato.displayPorta = parametros.textoDisplay;
    }
    candidato.ultimaAtualizacao = new Date().toISOString();

    // Submete ao Quorum antes de gravar
    const aprovado = await executarQuorumLider(
      'INVOCACAO_METODO',
      `Configuração de atuadores via ${CONTROLLER_ID}`,
      candidato,
      true
    );

    return {
      sucesso: aprovado,
      metodoInvocado: 'configurarAtuadores()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: aprovado
        ? `Atuadores validados por Quorum 2x1 e persistidos no MongoDB 1 pelo Líder!`
        : `Consenso rejeitado: Quorum não atingido.`,
      estado: estadoLocal,
    };
  }
}

// Instancia o Objeto Distribuído do Líder
const objetoControlador = new ControladorProcessoSala1();

// Inicia conexão com o MongoDB 1
inicializarMongoDB();

// Conecta ao Broker MQTT
const mqttClient = mqtt.connect(BROKER_URL, {
  clientId: `${CONTROLLER_ID}_${Math.random().toString(16).slice(2, 6)}`,
});

// Evento disparado ao conectar no Broker MQTT
mqttClient.on('connect', () => {
  console.log(`[${CONTROLLER_ID}] Líder conectado ao Broker MQTT em ${BROKER_URL}`);
  const topicosAssinados = [
    'clinica/sala1/ruido',
    'clinica/sala1/bpm',
    'clinica/sala1/presenca',
    'clinica/sala1/porta',
    'clinica/recepcao/checkin',
  ];
  mqttClient.subscribe(topicosAssinados, { qos: 0 }, (err) => {
    if (!err) {
      console.log(`[${CONTROLLER_ID}] Assinaturas MQTT ativas: ${topicosAssinados.join(', ')}`);
    }
  });
});

// Processa mensagens MQTT aplicando Quorum 2x1 antes de persistir no MongoDB
mqttClient.on('message', async (topic, message) => {
  try {
    const dados = JSON.parse(message.toString());
    const ts = dados.timestamp || new Date().toISOString();

    // Telemetria de Ruído
    if (topic === 'clinica/sala1/ruido' && typeof dados.db === 'number') {
      const candidato: EstadoSala = JSON.parse(JSON.stringify(estadoLocal));
      candidato.ruidoDb = dados.db;
      candidato.ultimaAtualizacao = ts;

      let publicarAtuadores = false;
      if (candidato.ruidoDb > 85 || candidato.bpm > 120) {
        candidato.iluminacao = 'Azul / Calmante';
        candidato.smartSpeaker = 'Frequência Calmante (Ruído Branco)';
        candidato.displayPorta = '> Regulação em Curso (Não Entre)';
        candidato.modoCalmaAtivo = true;
        publicarAtuadores = true;
      } else if (candidato.modoCalmaAtivo && Date.now() >= candidato.overrideManualAte) {
        candidato.modoCalmaAtivo = false;
        candidato.iluminacao = candidato.presenca ? `Cor Favorita (${candidato.corFavorita})` : 'Branca / Alto Contraste';
        candidato.smartSpeaker = candidato.presenca ? `Playlist do Paciente (${candidato.musicaFavorita})` : 'Aguardando paciente';
        candidato.displayPorta = candidato.presenca ? `> Em Atendimento (${candidato.tagId})` : '> Sala 1 - Livre';
        publicarAtuadores = true;
      }

      await executarQuorumLider('TELEMETRIA', `Ruído do Simulador: ${dados.db} dB`, candidato, publicarAtuadores);
    }
    // Telemetria de BPM
    else if (topic === 'clinica/sala1/bpm' && typeof dados.bpm === 'number') {
      const candidato: EstadoSala = JSON.parse(JSON.stringify(estadoLocal));
      candidato.bpm = dados.bpm;
      candidato.ultimaAtualizacao = ts;

      let publicarAtuadores = false;
      if (candidato.ruidoDb > 85 || candidato.bpm > 120) {
        candidato.iluminacao = 'Azul / Calmante';
        candidato.smartSpeaker = 'Frequência Calmante (Ruído Branco)';
        candidato.displayPorta = '> Regulação em Curso (Não Entre)';
        candidato.modoCalmaAtivo = true;
        publicarAtuadores = true;
      } else if (candidato.modoCalmaAtivo && Date.now() >= candidato.overrideManualAte) {
        candidato.modoCalmaAtivo = false;
        candidato.iluminacao = candidato.presenca ? `Cor Favorita (${candidato.corFavorita})` : 'Branca / Alto Contraste';
        candidato.smartSpeaker = candidato.presenca ? `Playlist do Paciente (${candidato.musicaFavorita})` : 'Aguardando paciente';
        candidato.displayPorta = candidato.presenca ? `> Em Atendimento (${candidato.tagId})` : '> Sala 1 - Livre';
        publicarAtuadores = true;
      }

      await executarQuorumLider('TELEMETRIA', `BPM do Simulador: ${dados.bpm} BPM`, candidato, publicarAtuadores);
    }
    // Gerenciamento de Fila de Espera (Check-in via recepção)
    else if (topic === 'clinica/recepcao/checkin') {
      const { acao, nome, musica, cor } = dados;
      if (acao === 'entrar_fila') {
        const candidato: EstadoSala = JSON.parse(JSON.stringify(estadoLocal));
        const nomeLimpo = (nome || '').trim();
        const musicaLimpa = musica || 'Rock';
        const corLimpa = cor || 'Azul';
        candidato.ultimaAtualizacao = ts;

        let publicarAtuadores = false;
        if (!candidato.presenca) {
          candidato.presenca = true;
          candidato.tagId = nomeLimpo;
          candidato.musicaFavorita = musicaLimpa;
          candidato.corFavorita = corLimpa;
          if (!candidato.modoCalmaAtivo) {
            candidato.iluminacao = `Cor Favorita (${corLimpa})`;
            candidato.smartSpeaker = `Playlist do Paciente (${musicaLimpa})`;
            candidato.displayPorta = `> Em Atendimento (${nomeLimpo})`;
            publicarAtuadores = true;
          }
        } else {
          if (candidato.tagId.toLowerCase() === nomeLimpo.toLowerCase()) {
            candidato.musicaFavorita = musicaLimpa;
            candidato.corFavorita = corLimpa;
          } else {
            const index = candidato.filaEspera.findIndex((p) => p.nome.toLowerCase() === nomeLimpo.toLowerCase());
            if (index === -1) {
              candidato.filaEspera.push({
                nome: nomeLimpo,
                musica: musicaLimpa,
                cor: corLimpa,
                horario: new Date().toLocaleTimeString('pt-BR'),
              });
            } else {
              candidato.filaEspera[index].musica = musicaLimpa;
              candidato.filaEspera[index].cor = corLimpa;
            }
          }
        }

        await executarQuorumLider('FILA', `Check-in de paciente: ${nomeLimpo}`, candidato, publicarAtuadores);
      }
    }
    // Entrada/Saída manual de sala
    else if (topic === 'clinica/sala1/presenca' || topic === 'clinica/sala1/porta') {
      const candidato: EstadoSala = JSON.parse(JSON.stringify(estadoLocal));
      const presencaBool = Boolean(dados.presenca);
      candidato.ultimaAtualizacao = ts;

      let publicarAtuadores = false;
      if (presencaBool) {
        candidato.presenca = true;
        candidato.tagId = dados.nome || 'Paciente';
        candidato.musicaFavorita = dados.musica || 'Rock';
        candidato.corFavorita = dados.cor || 'Azul';
        if (!candidato.modoCalmaAtivo) {
          candidato.iluminacao = `Cor Favorita (${candidato.corFavorita})`;
          candidato.smartSpeaker = `Playlist do Paciente (${candidato.musicaFavorita})`;
          candidato.displayPorta = `> Em Atendimento (${candidato.tagId})`;
          publicarAtuadores = true;
        }
      } else {
        if (candidato.filaEspera.length > 0) {
          const proximo = candidato.filaEspera.shift()!;
          candidato.presenca = true;
          candidato.tagId = proximo.nome;
          candidato.musicaFavorita = proximo.musica;
          candidato.corFavorita = proximo.cor;
          if (!candidato.modoCalmaAtivo) {
            candidato.iluminacao = `Cor Favorita (${proximo.cor})`;
            candidato.smartSpeaker = `Playlist do Paciente (${proximo.musica})`;
            candidato.displayPorta = `> Em Atendimento (${proximo.nome})`;
            publicarAtuadores = true;
          }
        } else {
          candidato.presenca = false;
          candidato.tagId = 'Nenhum paciente';
          candidato.musicaFavorita = 'Aguardando paciente';
          if (!candidato.modoCalmaAtivo) {
            candidato.iluminacao = 'Branca / Alto Contraste';
            candidato.smartSpeaker = 'Aguardando paciente';
            candidato.displayPorta = '> Sala 1 - Livre';
            publicarAtuadores = true;
          }
        }
      }

      await executarQuorumLider('TELEMETRIA', `Alteração de presença na sala (presença=${presencaBool})`, candidato, publicarAtuadores);
    }
  } catch (err) {
    console.error(`[${CONTROLLER_ID}] Erro ao processar mensagem MQTT:`, err);
  }
});

// Instancia o servidor gRPC para expor os procedimentos remotos na porta 3001
const grpcServer = new grpc.Server();

// Registra os métodos do serviço MiddlewareClinico no servidor gRPC
grpcServer.addService(diverterapiaProto.MiddlewareClinico.service, {
  // Handler RPC para o método ObterStatus
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
      callback({
        code: grpc.status.INTERNAL,
        message: err?.message || 'Erro ao consultar status no Controlador Líder',
      });
    }
  },

  // Handler RPC para o método AtivarModoCalmaManual
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
      callback({
        code: grpc.status.INTERNAL,
        message: err?.message || 'Erro ao ativar modo calma no Controlador Líder',
      });
    }
  },

  // Handler RPC para o método InvocarMetodo
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
      callback({
        code: grpc.status.INTERNAL,
        message: err?.message || 'Erro ao invocar método no Controlador Líder',
      });
    }
  },

  // Handler RPC para o método ToggleBizantino
  ToggleBizantino: async (_call: any, callback: any) => {
    callback(null, {
      sucesso: true,
      metodoInvocado: 'ToggleBizantino()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: 'Controlador 1 é o Líder e opera sempre com integridade garantida.',
      estado: sanitizarEstadoParaGrpc(estadoLocal),
    });
  },
});

// Registra o serviço ConsensoInterno no Controlador Líder
grpcServer.addService(diverterapiaProto.ConsensoInterno.service, {
  // Retorna o voto do próprio Líder caso consultado
  VotarEstado: async (_call: any, callback: any) => {
    callback(null, {
      controlador: CONTROLLER_ID,
      porta: GRPC_PORT,
      aprova: true,
      estadoVotado: sanitizarEstadoParaGrpc(estadoLocal),
      justificativa: 'Voto íntegro do Controlador Líder 1',
    });
  },

  // Efetivação interna caso invocada
  EfetivarEstado: async (call: any, callback: any) => {
    const { tipo, descricao, estadoValidado } = call.request;
    if (estadoValidado) Object.assign(estadoLocal, estadoValidado);
    await salvarReplicaMongoDB(tipo || 'CONSENSO', descricao || 'Efetivado');
    callback(null, {
      sucesso: true,
      metodoInvocado: 'EfetivarEstado()',
      processadoPor: CONTROLLER_ID,
      porta: GRPC_PORT,
      mensagem: 'Efetivado no Líder',
      estado: sanitizarEstadoParaGrpc(estadoLocal),
    });
  },
});

// Vincula o servidor gRPC ao endereço e porta definidos
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
    console.log(`   -> Banco de Dados: ${MONGO_URI}`);
    console.log(`   -> Mecanismo: Quorum 2x1 com Validação Pré-Persistência`);
    console.log(`=====================================================`);
  }
);
