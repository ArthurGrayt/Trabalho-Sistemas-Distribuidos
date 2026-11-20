// Importa o módulo nativo 'fs' para leitura opcional do arquivo .env na raiz do projeto
import fs from 'fs';
// Importa o módulo nativo 'path' para resolver o caminho absoluto do arquivo .env
import path from 'path';
// Importa o 'mongoose' para modelagem, conexão, reconexão e persistência no MongoDB
import mongoose, { Schema, Document } from 'mongoose';
// Importa tipos e utilitários determinísticos compartilhados do domínio clínico
import {
  EstadoSala,
  RegistroHistorico,
  normalizarEstadoRecebido,
} from './regrasClinicas';

// Define a chave lógica única do documento da Sala 1 na coleção do MongoDB
export const SALA_DOC_ID = 'sala-1';

// Flag de módulo que garante que o carregamento do arquivo .env aconteça apenas uma vez
let envLocalCarregado = false;

// Função auxiliar que lê variáveis de um arquivo .env na raiz do projeto sem depender de pacotes externos
export function carregarEnvLocal(): void {
  // Evita reler o disco caso o arquivo .env já tenha sido processado
  if (envLocalCarregado) {
    return;
  }
  // Marca a flag antes da leitura para prevenir chamadas repetidas
  envLocalCarregado = true;

  // Resolve o caminho esperado do arquivo .env na raiz do repositório
  const caminhoEnv = path.resolve(__dirname, '../.env');
  // Interrompe silenciosamente se o arquivo .env não existir no ambiente atual
  if (!fs.existsSync(caminhoEnv)) {
    return;
  }

  try {
    // Lê todo o conteúdo textual do arquivo .env em UTF-8
    const conteudo = fs.readFileSync(caminhoEnv, 'utf8');
    // Quebra o conteúdo em linhas suportando quebras de linha Windows (CRLF) e Unix (LF)
    const linhas = conteudo.split(/\r?\n/);

    // Percorre cada linha do arquivo .env para extrair pares CHAVE=VALOR
    for (const linhaBruta of linhas) {
      // Remove espaços em branco nas extremidades da linha
      const linha = linhaBruta.trim();
      // Ignora linhas vazias ou linhas de comentário iniciadas por '#'
      if (!linha || linha.startsWith('#')) {
        continue;
      }
      // Localiza o primeiro separador '=' entre nome da variável e valor
      const indiceIgual = linha.indexOf('=');
      // Ignora linhas malformadas que não contenham '=' ou tenham chave vazia
      if (indiceIgual <= 0) {
        continue;
      }
      // Extrai o nome da variável de ambiente removendo espaços e eventual prefixo 'export '
      const chave = linha.slice(0, indiceIgual).replace(/^export\s+/i, '').trim();
      // Extrai o valor bruto à direita do sinal '='
      let valor = linha.slice(indiceIgual + 1).trim();
      // Remove aspas duplas ou simples que envolvam o valor completo
      if (
        (valor.startsWith('"') && valor.endsWith('"') && valor.length >= 2) ||
        (valor.startsWith("'") && valor.endsWith("'") && valor.length >= 2)
      ) {
        // Descarta os caracteres de aspas inicial e final
        valor = valor.slice(1, -1);
      }
      // Define a variável apenas se não tiver sido fornecida externamente pelo shell
      if (chave && process.env[chave] === undefined) {
        // Atribui o valor extraído ao objeto global process.env
        process.env[chave] = valor;
      }
    }
  } catch (err) {
    // Registra aviso caso haja erro de permissão ou leitura no .env sem interromper o boot
    console.warn('[PERSISTÊNCIA MONGO] Não foi possível ler o arquivo .env local:', err);
  }
}

// Carrega imediatamente as variáveis de ambiente locais quando o módulo é importado
carregarEnvLocal();

// Função auxiliar que mascara usuário e senha em URIs MongoDB antes de exibir em logs ou na API
export function mascararUriMongo(uri: string): string {
  // Substitui credenciais no formato "://usuario:senha@" por "://***@" mantendo host e database visíveis
  return uri.replace(/:\/\/[^/@]+@/g, '://***@');
}

// Função auxiliar que resolve a URI do MongoDB a partir de process.env com fallback para a URI padrão
export function resolverUriMongo(nomeVarEnv: string, uriPadrao: string): string {
  // Garante que o arquivo .env local já foi carregado antes de consultar process.env
  carregarEnvLocal();
  // Lê a variável de ambiente solicitada removendo espaços extras
  const valorEnv = process.env[nomeVarEnv]?.trim();
  // Retorna o valor configurado no ambiente se preenchido, ou a URI padrão caso contrário
  return valorEnv && valorEnv.length > 0 ? valorEnv : uriPadrao;
}

// Interface do documento Mongoose combinando EstadoSala com Document
export interface EstadoSalaDocument extends EstadoSala, Document {
  // Identificador lógico único da sala persistido na coleção
  salaId: string;
}

// Sub-schema do Mongoose para os registros de auditoria histórica
const RegistroHistoricoSchema = new Schema<RegistroHistorico>(
  {
    // Carimbo temporal ISO do registro
    horario: { type: String, required: true },
    // Categoria do evento auditado
    tipo: { type: String, required: true },
    // Descrição legível da operação
    descricao: { type: String, required: true },
  },
  // Desativa geração automática de _id nos subdocumentos do histórico
  { _id: false }
);

// Schema principal do Mongoose armazenado na coleção 'estados_sala' de cada instância MongoDB
const EstadoSalaSchema = new Schema<EstadoSalaDocument>(
  {
    // Chave primária lógica garantindo documento único para a Sala 1
    salaId: { type: String, required: true, unique: true, default: SALA_DOC_ID },
    // Nível de ruído acústico em dB
    ruidoDb: { type: Number, required: true, default: 62 },
    // Frequência cardíaca em BPM
    bpm: { type: Number, required: true, default: 80 },
    // Indicador de presença física de paciente
    presenca: { type: Boolean, required: true, default: false },
    // Nome ou identificador do paciente em atendimento
    tagId: { type: String, required: true, default: 'Nenhum paciente' },
    // Estilo musical preferido do paciente atual
    musicaFavorita: { type: String, required: true, default: 'Aguardando paciente' },
    // Cor favorita selecionada pelo paciente atual
    corFavorita: { type: String, required: true, default: 'Branco' },
    // Estado atual do atuador de iluminação RGB
    iluminacao: { type: String, required: true, default: 'Branca / Alto Contraste' },
    // Estado atual do atuador Smart Speaker
    smartSpeaker: { type: String, required: true, default: 'Aguardando paciente' },
    // Texto exibido no atuador Display de Porta
    displayPorta: { type: String, required: true, default: '> Sala 1 - Livre' },
    // Flag indicando se o protocolo de Regulação Sensorial está ativo
    modoCalmaAtivo: { type: Boolean, required: true, default: false },
    // Timestamp numérico até quando o override manual possui prioridade
    overrideManualAte: { type: Number, required: true, default: 0 },
    // Carimbo temporal ISO da última atualização sincronizada
    ultimaAtualizacao: { type: String, required: true, default: () => new Date().toISOString() },
    // Lista dos últimos 15 eventos persistidos para auditoria
    historico: { type: [RegistroHistoricoSchema], default: [] },
  },
  // Remove o campo interno __v do Mongoose
  { versionKey: false }
);

// Cria ou reutiliza o Model Mongoose associado à coleção 'estados_sala' evitando OverwriteModelError
export const EstadoSalaModel =
  (mongoose.models.EstadoSala as mongoose.Model<EstadoSalaDocument>) ||
  mongoose.model<EstadoSalaDocument>('EstadoSala', EstadoSalaSchema, 'estados_sala');

// Função auxiliar interna que verifica se um EstadoSala já possui eventos clínicos reais além de INICIALIZACAO
function temEventoClinico(estado: EstadoSala): boolean {
  // Verifica se existe ao menos um registro no histórico cujo tipo seja diferente de 'INICIALIZACAO'
  return Array.isArray(estado?.historico) && estado.historico.some((reg) => reg?.tipo !== 'INICIALIZACAO');
}

// Função determinística para decidir se um nó deve absorver o estado remoto durante catch-up ou reconexão
export function deveAbsorverEstadoRemoto(estadoLocal: EstadoSala, estadoRemoto: EstadoSala): boolean {
  // Verifica se o estado local possui histórico clínico real
  const localTemClinico = temEventoClinico(estadoLocal);
  // Verifica se o estado remoto possui histórico clínico real
  const remotoTemClinico = temEventoClinico(estadoRemoto);

  // Se o nó local ainda é virgem (sem eventos clínicos) e o remoto já possui eventos reais, absorve sempre
  if (!localTemClinico && remotoTemClinico) {
    return true;
  }
  // Se o nó local já possui eventos reais e o remoto é virgem, não sobrescreve o estado real local
  if (localTemClinico && !remotoTemClinico) {
    return false;
  }

  // Converte os carimbos temporais ISO em milissegundos para comparação cronológica
  const tsLocal = Date.parse(estadoLocal?.ultimaAtualizacao || '');
  // Converte o carimbo temporal remoto em milissegundos
  const tsRemoto = Date.parse(estadoRemoto?.ultimaAtualizacao || '');
  // Absorve apenas quando o timestamp remoto é válido e estritamente mais recente que o local
  return Number.isFinite(tsRemoto) && (!Number.isFinite(tsLocal) || tsRemoto > tsLocal);
}

// Interface de configuração recebida pela fábrica de gerenciamento de persistência MongoDB
export interface ConfiguracaoGerenciadorMongo {
  // Identificador do controlador (ex: 'controlador-1')
  controllerId: string;
  // Número ordinal da instância MongoDB associada ao nó (1, 2 ou 3)
  numeroInstancia: 1 | 2 | 3;
  // Nome da variável de ambiente que pode sobrescrever a URI padrão (ex: 'MONGO_URI_1')
  nomeVarEnv: string;
  // URI padrão utilizada quando nenhuma variável de ambiente for informada
  uriPadrao: string;
  // Callback que retorna a referência atual do estado em memória do controlador
  obterEstadoAtual: () => EstadoSala;
  // Callback executado quando um estado recuperado do banco precisa atualizar a memória do controlador
  aplicarEstadoRecuperado: (estado: EstadoSala) => void;
}

// Interface pública exposta pelo gerenciador de persistência MongoDB de cada controlador
export interface GerenciadorMongo {
  // URI completa resolvida para conexão
  uri: string;
  // URI com usuário e senha mascarados para exibição segura
  uriMascarada: string;
  // Indica em tempo real se a conexão Mongoose está estabelecida (readyState === 1)
  estaConectado: () => boolean;
  // Retorna a identificação formatada do armazenamento indicando se está conectado ou em Fallback RAM
  obterArmazenamentoId: () => string;
  // Persiste o estado completo no MongoDB via upsert retornando true apenas se gravou de fato no banco
  persistirEstado: (estado: EstadoSala) => Promise<boolean>;
  // Anexa um registro opcional ao histórico em memória e persiste o estado retornando true se gravou no banco
  anexarHistoricoEPersistir: (
    estado: EstadoSala,
    tipo: string,
    descricao: string,
    adicionarHistorico: boolean
  ) => Promise<boolean>;
  // Inicializa a conexão no boot, executa crash-recovery e inicia o monitor de reconexão automática
  inicializar: () => Promise<boolean>;
}

// Fábrica que cria o gerenciador isolado de persistência MongoDB para um controlador específico
export function criarGerenciadorMongo(config: ConfiguracaoGerenciadorMongo): GerenciadorMongo {
  // Desestrutura os campos da configuração recebida
  const {
    controllerId,
    numeroInstancia,
    nomeVarEnv,
    uriPadrao,
    obterEstadoAtual,
    aplicarEstadoRecuperado,
  } = config;

  // Resolve a URI final considerando variáveis de ambiente e fallback padrão
  const uri = resolverUriMongo(nomeVarEnv, uriPadrao);
  // Gera a versão mascarada da URI para logs e respostas gRPC
  const uriMascarada = mascararUriMongo(uri);
  // Controla se os listeners de eventos da conexão Mongoose já foram registrados
  let listenersRegistrados = false;
  // Controla se o temporizador periódico de reconexão já foi iniciado
  let monitorReconexaoAtivo = false;
  // Impede tentativas sobrepostas de reconexão enquanto uma chamada mongoose.connect está em andamento
  let reconectando = false;
  // Rastreia se o controlador já obteve conexão bem-sucedida ao menos uma vez para evitar falso alerta de queda
  let jaEsteveConectado = false;

  // Função auxiliar que informa se a conexão atual com o MongoDB está ativa e pronta para queries
  const estaConectado = (): boolean => {
    // Retorna true somente quando o estado do Mongoose é 1 (connected)
    return mongoose.connection.readyState === 1;
  };

  // Função auxiliar que monta a string real de status do armazenamento para logs e campo armazenamentoId
  const obterArmazenamentoId = (): string => {
    // Verifica o estado real da conexão Mongoose antes de compor a mensagem
    if (estaConectado()) {
      // Informa conexão ativa com o MongoDB e a URI mascarada
      return `MongoDB ${numeroInstancia} [CONECTADO] (${uriMascarada})`;
    }
    // Informa explicitamente que o nó está operando em Fallback RAM por falta de conexão com o MongoDB
    return `MongoDB ${numeroInstancia} [OFFLINE - RAM] (${uriMascarada})`;
  };

  // Registra listeners de ciclo de vida na conexão Mongoose uma única vez
  const registrarListenersConexao = (): void => {
    // Ignora se os listeners já foram anexados anteriormente
    if (listenersRegistrados) {
      return;
    }
    // Marca que os listeners foram registrados
    listenersRegistrados = true;

    // Marca a flag quando a conexão com o MongoDB é estabelecida com sucesso
    mongoose.connection.on('connected', () => {
      // Sinaliza que já houve uma conexão ativa nesta sessão
      jaEsteveConectado = true;
    });

    // Notifica no console apenas se uma conexão previamente estabelecida cair em tempo de execução
    mongoose.connection.on('disconnected', () => {
      // Ignora eventos internos disparados pelo Mongoose quando o connect inicial ou o retry falham
      if (!jaEsteveConectado) {
        return;
      }
      // Reseta a flag até que a reconexão seja concluída novamente
      jaEsteveConectado = false;
      // Exibe alerta informando entrada automática em Fallback RAM
      console.warn(
        `⚠️ [${controllerId}] Conexão com MongoDB ${numeroInstancia} perdida — operando em Fallback RAM até reconectar.`
      );
    });

    // Notifica no console quando o driver nativo do MongoDB restabelece uma conexão existente
    mongoose.connection.on('reconnected', () => {
      // Atualiza a flag confirmando que a conexão foi restabelecida
      jaEsteveConectado = true;
      // Confirma o retorno da persistência ativa no banco
      console.log(`🔄 [${controllerId}] Reconexão automática com MongoDB ${numeroInstancia} estabelecida!`);
    });
  };

  // Persiste o estado fornecido na coleção 'estados_sala' via upsert atômico
  const persistirEstado = async (estado: EstadoSala): Promise<boolean> => {
    // Aborta e sinaliza false caso o MongoDB não esteja conectado no momento
    if (!estaConectado()) {
      return false;
    }

    try {
      // Atualiza ou cria o documento singleton da Sala 1 de forma atômica no MongoDB
      await EstadoSalaModel.findOneAndUpdate(
        { salaId: SALA_DOC_ID },
        { $set: { salaId: SALA_DOC_ID, ...estado } },
        { upsert: true, new: true }
      ).lean();
      // Retorna true confirmando gravação real no banco de dados
      return true;
    } catch (err) {
      // Registra eventual erro de escrita sem derrubar o servidor gRPC
      console.error(`[${controllerId}] Erro ao persistir no MongoDB ${numeroInstancia} (${uriMascarada}):`, err);
      // Retorna false informando que a persistência em disco falhou
      return false;
    }
  };

  // Anexa registro opcional de auditoria ao histórico e tenta gravar o estado no MongoDB
  const anexarHistoricoEPersistir = async (
    estado: EstadoSala,
    tipo: string,
    descricao: string,
    adicionarHistorico: boolean
  ): Promise<boolean> => {
    // Insere nova entrada no topo do histórico apenas quando solicitado pelo coordenador ou evento local
    if (adicionarHistorico) {
      // Cria o objeto de registro de auditoria com carimbo ISO atual
      const novoRegistro: RegistroHistorico = {
        horario: new Date().toISOString(),
        tipo,
        descricao,
      };
      // Atualiza a janela deslizante mantendo no máximo os 15 registros mais recentes
      estado.historico = [novoRegistro, ...estado.historico.slice(0, 14)];
    }

    // Executa o upsert no MongoDB retornando true somente se o banco confirmou a gravação
    return persistirEstado(estado);
  };

  // Inicia o monitor periódico em segundo plano para reconectar caso o MongoDB suba depois dos controladores
  const iniciarMonitorReconexao = (): void => {
    // Garante que apenas um intervalo seja criado por controlador
    if (monitorReconexaoAtivo) {
      return;
    }
    // Marca o monitor como ativo
    monitorReconexaoAtivo = true;

    // Agenda verificação a cada 10 segundos para tentar reconexão quando desconectado
    const intervalo = setInterval(async () => {
      // Executa apenas quando Mongoose estiver estritamente desconectado (readyState === 0) e sem tentativa ativa
      if (mongoose.connection.readyState !== 0 || reconectando) {
        return;
      }

      // Bloqueia tentativas simultâneas de reconexão
      reconectando = true;
      try {
        // Tenta abrir conexão com timeout curto de 2 segundos para não travar o event loop
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
        // Após conectar, verifica se já existe estado salvo anteriormente no MongoDB
        const docExistente = await EstadoSalaModel.findOne({ salaId: SALA_DOC_ID }).lean();
        // Extrai o estado atual mantido em memória RAM durante o período offline
        const estadoEmMemoria = obterEstadoAtual();

        if (docExistente) {
          // Converte o documento BSON encontrado para o formato tipado EstadoSala
          const estadoBanco = normalizarEstadoRecebido(docExistente);
          // Decide se o banco possui estado clínico mais atual que a RAM ou se a RAM deve atualizar o banco
          if (deveAbsorverEstadoRemoto(estadoEmMemoria, estadoBanco)) {
            // Atualiza a memória do controlador com o estado mais recente recuperado do banco
            aplicarEstadoRecuperado(estadoBanco);
            // Informa que a reconexão restaurou dados mais recentes do MongoDB
            console.log(
              `🔄 [${controllerId}] Reconectado ao MongoDB ${numeroInstancia}! Estado recuperado do banco.`
            );
          } else {
            // Sincroniza o estado acumulado em memória RAM para dentro do MongoDB recém-conectado
            await persistirEstado(estadoEmMemoria);
            // Informa que a memória RAM foi gravada no MongoDB após a reconexão
            console.log(
              `🔄 [${controllerId}] Reconectado ao MongoDB ${numeroInstancia}! Estado em RAM sincronizado com o banco.`
            );
          }
        } else {
          // Primeiro documento criado no MongoDB após a reconexão recebe o estado atual em RAM
          await persistirEstado(estadoEmMemoria);
          // Confirma a sincronização inicial pós-reconexão
          console.log(
            `🔄 [${controllerId}] Reconectado ao MongoDB ${numeroInstancia}! Estado em RAM sincronizado com o banco.`
          );
        }
      } catch {
        // Silencia erros de conexão no polling de 10s para evitar poluição visual no terminal
      } finally {
        // Libera a trava para permitir futuras tentativas caso a conexão caia novamente
        reconectando = false;
      }
    }, 10000);

    // Permite que o processo Node.js encerre normalmente sem ficar preso pelo timer de reconexão
    if (typeof intervalo.unref === 'function') {
      intervalo.unref();
    }
  };

  // Executa a conexão inicial no boot do controlador, faz crash-recovery e arma o monitor de reconexão
  const inicializar = async (): Promise<boolean> => {
    // Registra os handlers de eventos da conexão Mongoose
    registrarListenersConexao();

    try {
      // Conecta à instância MongoDB com timeout rápido de 2,5s caso o banco não esteja ativo
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
      // Confirma conexão bem-sucedida no terminal
      console.log(`[${controllerId}] Conectado com sucesso ao MongoDB ${numeroInstancia} em ${uriMascarada}`);

      // Consulta se já existe documento persistido de sessões anteriores
      const docExistente = await EstadoSalaModel.findOne({ salaId: SALA_DOC_ID }).lean();
      if (docExistente) {
        // Aplica crash-recovery restaurando o estado completo salvo no MongoDB
        aplicarEstadoRecuperado(normalizarEstadoRecebido(docExistente));
        // Confirma recuperação de estado no console
        console.log(`[${controllerId}] Estado recuperado do MongoDB ${numeroInstancia}.`);
      } else {
        // Se for o primeiro boot do banco, grava o documento inicial com registro de inicialização
        await anexarHistoricoEPersistir(
          obterEstadoAtual(),
          'INICIALIZACAO',
          `${controllerId} inicializou o documento no MongoDB ${numeroInstancia}`,
          true
        );
      }
    } catch {
      // Informa indisponibilidade inicial e ativação do modo Fallback RAM com retry periódico
      console.warn(
        `⚠️ [${controllerId}] MongoDB ${numeroInstancia} (${uriMascarada}) inacessível — operando em Fallback RAM (reconexão automática a cada 10s).`
      );
    }

    // Inicia o monitor de reconexão automática em segundo plano independentemente do resultado inicial
    iniciarMonitorReconexao();
    // Retorna se a conexão inicial foi estabelecida com sucesso
    return estaConectado();
  };

  // Retorna a API pública do gerenciador de persistência MongoDB
  return {
    uri,
    uriMascarada,
    estaConectado,
    obterArmazenamentoId,
    persistirEstado,
    anexarHistoricoEPersistir,
    inicializar,
  };
}
