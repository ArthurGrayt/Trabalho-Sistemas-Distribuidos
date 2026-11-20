// Importa o tipo MqttClient da biblioteca 'mqtt' para tipar o envio de comandos aos atuadores
import type { MqttClient } from 'mqtt';

// Interface que representa um registro individual de auditoria persistido no MongoDB
export interface RegistroHistorico {
  // Identificador temporal do evento em formato ISO 8601
  horario: string;
  // Categoria do evento registrado (TELEMETRIA, INVOCACAO_METODO, CONSENSO, INICIALIZACAO)
  tipo: string;
  // Descrição detalhada da decisão clínica ou mudança de estado
  descricao: string;
}

// Interface que modela o Objeto Distribuído completo da Sala 1 gerenciado pelo Middleware
export interface EstadoSala {
  // Último nível de ruído acústico em decibéis (dB)
  ruidoDb: number;
  // Última frequência cardíaca medida em batimentos por minuto (BPM)
  bpm: number;
  // Indica se existe um paciente atualmente presente na sala
  presenca: boolean;
  // Nome ou identificador do paciente em atendimento na Sala 1
  tagId: string;
  // Estilo musical favorito do paciente atual
  musicaFavorita: string;
  // Cor de iluminação favorita do paciente atual
  corFavorita: string;
  // Estado e cor configurados no atuador de Iluminação RGB
  iluminacao: string;
  // Estado e áudio reproduzido no atuador Smart Speaker
  smartSpeaker: string;
  // Texto exibido no atuador Visor da Porta
  displayPorta: string;
  // Indica se o protocolo de Regulação Sensorial (Modo Calma) está ativo
  modoCalmaAtivo: boolean;
  // Timestamp numérico (ms) limite para prioridade de comando manual (override)
  overrideManualAte: number;
  // Timestamp ISO 8601 da última alteração de estado sincronizada
  ultimaAtualizacao: string;
  // Lista dos últimos registros históricos de auditoria no banco
  historico: RegistroHistorico[];
}

// Interface que descreve o resultado determinístico do processamento de um evento MQTT
export interface ResultadoEventoMqtt {
  // Indica se o tópico e o payload correspondem a um evento clínico válido
  relevante: boolean;
  // Categoria de auditoria gerada pelo evento (TELEMETRIA)
  tipoEvento: string;
  // Texto descritivo do evento para registro no histórico
  descricao: string;
  // Novo estado candidato calculado sem mutar o estado original de entrada
  candidato: EstadoSala;
  // Flag indicando se os comandos aos atuadores físicos devem ser publicados via MQTT
  publicarAtuadores: boolean;
}

// Função fábrica que cria uma nova instância limpa do estado inicial da Sala 1
export function criarEstadoInicial(): EstadoSala {
  // Retorna todos os campos preenchidos com os valores padrão de repouso clínico
  return {
    // Ruído inicial confortável em repouso (62 dB)
    ruidoDb: 62,
    // Frequência cardíaca inicial normal (80 BPM)
    bpm: 80,
    // Sala inicia desocupada
    presenca: false,
    // Identificador indicando ausência de paciente
    tagId: 'Nenhum paciente',
    // Estado ocioso para trilha sonora
    musicaFavorita: 'Aguardando paciente',
    // Cor padrão neutra para sala livre
    corFavorita: 'Branco',
    // Iluminação inicial padrão de Foco Dirigido
    iluminacao: 'Branca / Alto Contraste',
    // Smart Speaker em modo de espera
    smartSpeaker: 'Aguardando paciente',
    // Mensagem inicial do visor externo da porta
    displayPorta: '> Sala 1 - Livre',
    // Protocolo de Regulação Sensorial inicialmente desligado
    modoCalmaAtivo: false,
    // Sem trava de override manual ativa no boot
    overrideManualAte: 0,
    // Carimbo temporal de inicialização do objeto
    ultimaAtualizacao: new Date().toISOString(),
    // Histórico inicial sem registros
    historico: [],
  };
}

// Função que realiza uma cópia profunda (deep clone) segura de um EstadoSala
export function clonarEstado(estado: EstadoSala): EstadoSala {
  // Retorna um novo objeto com arrays copiados e tipos numéricos preservados
  return {
    // Copia o nível de ruído como inteiro arredondado
    ruidoDb: Math.round(Number(estado.ruidoDb) || 62),
    // Copia o BPM como inteiro arredondado
    bpm: Math.round(Number(estado.bpm) || 80),
    // Copia a flag booleana de presença
    presenca: Boolean(estado.presenca),
    // Copia o identificador do paciente
    tagId: String(estado.tagId || 'Nenhum paciente'),
    // Copia a música favorita
    musicaFavorita: String(estado.musicaFavorita || 'Aguardando paciente'),
    // Copia a cor favorita
    corFavorita: String(estado.corFavorita || 'Branco'),
    // Copia o estado da iluminação
    iluminacao: String(estado.iluminacao || 'Branca / Alto Contraste'),
    // Copia o estado do smart speaker
    smartSpeaker: String(estado.smartSpeaker || 'Aguardando paciente'),
    // Copia o texto do visor da porta
    displayPorta: String(estado.displayPorta || '> Sala 1 - Livre'),
    // Copia o estado booleano do modo calma
    modoCalmaAtivo: Boolean(estado.modoCalmaAtivo),
    // Garante que overrideManualAte seja sempre um número válido (mesmo vindo de int64 string)
    overrideManualAte: Math.round(Number(estado.overrideManualAte) || 0),
    // Copia o timestamp ISO da última atualização
    ultimaAtualizacao: String(estado.ultimaAtualizacao || new Date().toISOString()),
    // Clona cada entrada do histórico de auditoria evitando mutações colaterais
    historico: Array.isArray(estado.historico)
      ? estado.historico.map((h) => ({
          // Copia o horário ISO do evento
          horario: String(h.horario || ''),
          // Copia a categoria do evento
          tipo: String(h.tipo || ''),
          // Copia a descrição detalhada
          descricao: String(h.descricao || ''),
        }))
      : [],
  };
}

// Função que normaliza qualquer documento BSON do MongoDB ou payload gRPC para EstadoSala tipado
export function normalizarEstadoRecebido(doc: any): EstadoSala {
  // Obtém um estado padrão caso o documento de entrada esteja incompleto
  const base = criarEstadoInicial();
  // Retorna o objeto normalizado garantindo tipos consistentes (especialmente int64 -> number)
  return {
    // Converte ruidoDb para número inteiro válido
    ruidoDb: Number.isFinite(Number(doc?.ruidoDb)) ? Math.round(Number(doc.ruidoDb)) : base.ruidoDb,
    // Converte bpm para número inteiro válido
    bpm: Number.isFinite(Number(doc?.bpm)) ? Math.round(Number(doc.bpm)) : base.bpm,
    // Converte presenca explicitamente para booleano
    presenca: Boolean(doc?.presenca),
    // Converte tagId para string segura
    tagId: String(doc?.tagId || base.tagId),
    // Converte musicaFavorita para string segura
    musicaFavorita: String(doc?.musicaFavorita || base.musicaFavorita),
    // Converte corFavorita para string segura
    corFavorita: String(doc?.corFavorita || base.corFavorita),
    // Converte iluminacao para string segura
    iluminacao: String(doc?.iluminacao || base.iluminacao),
    // Converte smartSpeaker para string segura
    smartSpeaker: String(doc?.smartSpeaker || base.smartSpeaker),
    // Converte displayPorta para string segura
    displayPorta: String(doc?.displayPorta || base.displayPorta),
    // Converte modoCalmaAtivo para booleano
    modoCalmaAtivo: Boolean(doc?.modoCalmaAtivo),
    // Converte int64 (string vinda do proto-loader com longs: String) para number
    overrideManualAte: Math.round(Number(doc?.overrideManualAte) || 0),
    // Normaliza ultimaAtualizacao para string ISO
    ultimaAtualizacao: String(doc?.ultimaAtualizacao || base.ultimaAtualizacao),
    // Normaliza o array de histórico para objetos planos sem referências Mongoose
    historico: Array.isArray(doc?.historico)
      ? doc.historico.map((h: any) => ({
          // Horário do registro
          horario: String(h?.horario || ''),
          // Tipo do registro
          tipo: String(h?.tipo || ''),
          // Descrição do registro
          descricao: String(h?.descricao || ''),
        }))
      : [],
  };
}

// Função que sanitiza um EstadoSala ou documento BSON para serialização limpa no contrato Protobuf gRPC
export function sanitizarEstadoParaGrpc(doc: any): any {
  // Reutiliza a normalização tipada para garantir consistência de todos os campos
  const normalizado = normalizarEstadoRecebido(doc);
  // Retorna o objeto exatamente no formato esperado pela mensagem EstadoSalaData do .proto
  return {
    // Nível de ruído (int32)
    ruidoDb: normalizado.ruidoDb,
    // Batimentos cardíacos (int32)
    bpm: normalizado.bpm,
    // Presença de paciente (bool)
    presenca: normalizado.presenca,
    // Identificação do paciente (string)
    tagId: normalizado.tagId,
    // Estilo musical favorito (string)
    musicaFavorita: normalizado.musicaFavorita,
    // Cor favorita (string)
    corFavorita: normalizado.corFavorita,
    // Estado da iluminação (string)
    iluminacao: normalizado.iluminacao,
    // Estado do Smart Speaker (string)
    smartSpeaker: normalizado.smartSpeaker,
    // Texto do visor da porta (string)
    displayPorta: normalizado.displayPorta,
    // Flag de modo calma (bool)
    modoCalmaAtivo: normalizado.modoCalmaAtivo,
    // Timestamp limite de override manual (int64)
    overrideManualAte: normalizado.overrideManualAte,
    // Data/hora da última sincronização
    ultimaAtualizacao: normalizado.ultimaAtualizacao,
    // Lista de registros históricos
    historico: normalizado.historico,
  };
}

// Função auxiliar interna que aplica as regras automáticas de Regulação Sensorial sobre um candidato
function avaliarRegulacaoSensorial(candidato: EstadoSala, agoraMs: number): boolean {
  // Verifica se o ruído ultrapassou 85 dB ou o BPM ultrapassou 120 (gatilho de crise sensorial)
  if (candidato.ruidoDb > 85 || candidato.bpm > 120) {
    // Configura a iluminação para o tom calmante azul
    candidato.iluminacao = 'Azul / Calmante';
    // Configura o Smart Speaker para reproduzir ruído branco calmante
    candidato.smartSpeaker = 'Frequência Calmante (Ruído Branco)';
    // Atualiza o visor da porta avisando a equipe para não interromper a regulação
    candidato.displayPorta = '> Regulação em Curso (Não Entre)';
    // Ativa a flag do protocolo de regulação sensorial
    candidato.modoCalmaAtivo = true;
    // Indica que os atuadores físicos precisam receber os novos comandos
    return true;
  }

  // Caso os níveis tenham normalizado e o período de override manual já tenha expirado
  if (candidato.modoCalmaAtivo && agoraMs >= Number(candidato.overrideManualAte || 0)) {
    // Desativa o modo calma pois o ambiente voltou à faixa segura
    candidato.modoCalmaAtivo = false;
    // Restaura a iluminação para a cor favorita do paciente ou branco de alto contraste se livre
    candidato.iluminacao = candidato.presenca
      ? `Cor Favorita (${candidato.corFavorita})`
      : 'Branca / Alto Contraste';
    // Restaura o áudio para a playlist do paciente ou modo de espera se livre
    candidato.smartSpeaker = candidato.presenca
      ? `Playlist do Paciente (${candidato.musicaFavorita})`
      : 'Aguardando paciente';
    // Restaura o visor da porta com o nome do paciente em atendimento ou sala livre
    candidato.displayPorta = candidato.presenca
      ? `> Em Atendimento (${candidato.tagId})`
      : '> Sala 1 - Livre';
    // Indica que os atuadores físicos devem ser atualizados com o estado restaurado
    return true;
  }

  // Nenhuma transição de modo calma ocorreu, logo não precisa republicar comandos aos atuadores
  return false;
}

// Função pura e determinística que calcula o novo EstadoSala candidato a partir de uma mensagem MQTT
export function aplicarEventoMqtt(estadoBase: EstadoSala, topic: string, dados: any): ResultadoEventoMqtt {
  // Cria um clone independente para não mutar o estado base antes do consenso
  const candidato = clonarEstado(estadoBase);
  // Extrai o timestamp enviado na mensagem ou gera um novo caso ausente
  const ts = String(dados?.timestamp || new Date().toISOString());
  // Converte o timestamp para milissegundos quando válido para avaliação determinística de override entre nós
  const agoraMs = dados?.timestamp && !Number.isNaN(Date.parse(ts)) ? Date.parse(ts) : Date.now();

  // Evento 1: Telemetria de ruído acústico em decibéis
  if (topic === 'clinica/sala1/ruido' && typeof dados?.db === 'number') {
    // Atualiza o valor de ruído arredondado no estado candidato
    candidato.ruidoDb = Math.round(dados.db);
    // Atualiza o carimbo temporal da última modificação
    candidato.ultimaAtualizacao = ts;
    // Avalia se o novo ruído ativa ou desativa a Regulação Sensorial
    const publicarAtuadores = avaliarRegulacaoSensorial(candidato, agoraMs);
    // Retorna o resultado pronto para votação de Quorum
    return {
      // Marca o evento como válido e relevante
      relevante: true,
      // Categoria de auditoria
      tipoEvento: 'TELEMETRIA',
      // Descrição legível para histórico
      descricao: `Ruído do Simulador: ${candidato.ruidoDb} dB`,
      // Estado candidato calculado
      candidato,
      // Indica se houve mudança nos atuadores
      publicarAtuadores,
    };
  }

  // Evento 2: Telemetria de batimentos cardíacos (BPM)
  if (topic === 'clinica/sala1/bpm' && typeof dados?.bpm === 'number') {
    // Atualiza o valor de BPM arredondado no estado candidato
    candidato.bpm = Math.round(dados.bpm);
    // Atualiza o carimbo temporal da última modificação
    candidato.ultimaAtualizacao = ts;
    // Avalia se o novo BPM ativa ou desativa a Regulação Sensorial
    const publicarAtuadores = avaliarRegulacaoSensorial(candidato, agoraMs);
    // Retorna o resultado pronto para votação de Quorum
    return {
      // Marca o evento como válido e relevante
      relevante: true,
      // Categoria de auditoria
      tipoEvento: 'TELEMETRIA',
      // Descrição legível para histórico
      descricao: `BPM do Simulador: ${candidato.bpm} BPM`,
      // Estado candidato calculado
      candidato,
      // Indica se houve mudança nos atuadores
      publicarAtuadores,
    };
  }

  // Evento 3: Entrada ou saída explícita na porta / sensor de presença
  if (topic === 'clinica/sala1/presenca' || topic === 'clinica/sala1/porta') {
    // Converte o campo presenca do payload para booleano
    const presencaBool = Boolean(dados?.presenca);
    // Atualiza o carimbo temporal da alteração
    candidato.ultimaAtualizacao = ts;
    // Inicializa flag de publicação nos atuadores
    let publicarAtuadores = false;

    // Se um paciente entrou fisicamente na sala
    if (presencaBool) {
      // Marca sala ocupada
      candidato.presenca = true;
      // Define o nome ou identificador do paciente
      candidato.tagId = String(dados?.nome || 'Paciente');
      // Define a música favorita
      candidato.musicaFavorita = String(dados?.musica || 'Rock');
      // Define a cor favorita
      candidato.corFavorita = String(dados?.cor || 'Azul');
      // Se não estiver em modo calma, personaliza os atuadores da sala
      if (!candidato.modoCalmaAtivo) {
        // Luz na cor favorita
        candidato.iluminacao = `Cor Favorita (${candidato.corFavorita})`;
        // Playlist favorita no speaker
        candidato.smartSpeaker = `Playlist do Paciente (${candidato.musicaFavorita})`;
        // Nome do paciente no visor da porta
        candidato.displayPorta = `> Em Atendimento (${candidato.tagId})`;
        // Solicita envio aos atuadores
        publicarAtuadores = true;
      }
    } else {
      // Libera completamente a sala e restaura os padrões neutros de repouso
      candidato.presenca = false;
      // Limpa identificador do paciente
      candidato.tagId = 'Nenhum paciente';
      // Reseta música favorita
      candidato.musicaFavorita = 'Aguardando paciente';
      // Reseta cor favorita para o padrão neutro Branco
      candidato.corFavorita = 'Branco';
      // Se não estiver em modo calma, retorna os atuadores ao estado de repouso
      if (!candidato.modoCalmaAtivo) {
        // Iluminação branca de alto contraste
        candidato.iluminacao = 'Branca / Alto Contraste';
        // Smart Speaker em espera
        candidato.smartSpeaker = 'Aguardando paciente';
        // Visor indicando sala disponível
        candidato.displayPorta = '> Sala 1 - Livre';
        // Solicita envio aos atuadores
        publicarAtuadores = true;
      }
    }

    // Retorna o candidato atualizado de presença na sala
    return {
      // Marca como evento válido
      relevante: true,
      // Categoria de auditoria
      tipoEvento: 'TELEMETRIA',
      // Descrição legível
      descricao: `Alteração de presença na sala (presença=${presencaBool})`,
      // Estado candidato gerado
      candidato,
      // Indica se houve atualização física nos atuadores
      publicarAtuadores,
    };
  }

  // Caso o tópico ou payload não corresponda a nenhum evento tratado
  return {
    // Evento ignorado
    relevante: false,
    // Tipo vazio
    tipoEvento: '',
    // Descrição vazia
    descricao: '',
    // Retorna clone inalterado
    candidato,
    // Não aciona atuadores
    publicarAtuadores: false,
  };
}

// Função pura que gera o estado candidato ao acionar manualmente o Protocolo de Regulação Sensorial
export function aplicarModoCalmaManual(
  estadoBase: EstadoSala,
  _origemCliente: string,
  timestampOverride?: number
): EstadoSala {
  // Clona o estado base sem modificar a referência original
  const candidato = clonarEstado(estadoBase);
  // Define o momento de referência para a janela de 15 segundos de prioridade manual
  const agora = typeof timestampOverride === 'number' ? timestampOverride : Date.now();
  // Configura o prazo limite do override manual (15s)
  candidato.overrideManualAte = agora + 15000;
  // Configura iluminação calmante azul
  candidato.iluminacao = 'Azul / Calmante';
  // Configura Smart Speaker com ruído branco
  candidato.smartSpeaker = 'Frequência Calmante (Ruído Branco)';
  // Configura mensagem restritiva no visor da porta
  candidato.displayPorta = '> Regulação em Curso (Não Entre)';
  // Ativa a flag do modo calma
  candidato.modoCalmaAtivo = true;
  // Registra o timestamp ISO da operação
  candidato.ultimaAtualizacao = new Date(agora).toISOString();
  // Devolve o estado candidato pronto para votação de Quorum
  return candidato;
}

// Função pura que gera o estado candidato ao invocar configurarAtuadores() remotamente
export function aplicarConfigurarAtuadores(
  estadoBase: EstadoSala,
  parametros: { corLuz?: string; somSpeaker?: string; textoDisplay?: string },
  timestampOverride?: number
): EstadoSala {
  // Clona o estado base para compor o candidato
  const candidato = clonarEstado(estadoBase);
  // Define o momento de referência para o override manual de 15s
  const agora = typeof timestampOverride === 'number' ? timestampOverride : Date.now();
  // Aplica prioridade manual de 15 segundos sobre automação de sensores
  candidato.overrideManualAte = agora + 15000;

  // Se uma cor de luz foi informada e não está vazia
  if (parametros?.corLuz) {
    // Normaliza o texto da cor para minúsculas visando comparação segura
    const corLower = parametros.corLuz.toLowerCase();
    // Ativa modoCalmaAtivo apenas para modos explícitos de calma (evita disparar para "Cor Favorita (Azul)")
    candidato.modoCalmaAtivo = corLower.includes('calmante') || corLower.includes('azul/calma');
    // Atualiza a iluminação configurada
    candidato.iluminacao = parametros.corLuz;
  }
  // Se um som de speaker foi informado
  if (parametros?.somSpeaker) {
    // Atualiza o estado do Smart Speaker
    candidato.smartSpeaker = parametros.somSpeaker;
  }
  // Se um texto de display foi informado
  if (parametros?.textoDisplay) {
    // Atualiza a mensagem exibida na porta
    candidato.displayPorta = parametros.textoDisplay;
  }
  // Atualiza o carimbo temporal da alteração
  candidato.ultimaAtualizacao = new Date(agora).toISOString();
  // Retorna o candidato pronto para consenso
  return candidato;
}

// Função comparadora para validação de votos no Quorum: detecta divergências semânticas e falhas bizantinas
export function compararEstados(candidato: EstadoSala, votado: any): boolean {
  // Rejeita imediatamente se qualquer um dos estados for nulo ou indefinido
  if (!candidato || !votado) return false;

  // Extrai o identificador de paciente votado para verificar assinaturas de corrupção
  const tagVotado = String(votado.tagId || '');
  // Rejeita votos com assinaturas conhecidas de ataque/falha bizantina
  if (tagVotado.includes('BIZANTINO') || tagVotado.includes('HACKED')) {
    return false;
  }

  // Compara ruído acústico com tolerância de até 5 dB (descarta valores forjados como 999 dB)
  const difRuido = Math.abs(Number(candidato.ruidoDb || 0) - Number(votado.ruidoDb || 0));
  if (difRuido > 5) {
    return false;
  }

  // Compara frequência cardíaca com tolerância de até 5 BPM (descarta valores forjados como 250 BPM)
  const difBpm = Math.abs(Number(candidato.bpm || 0) - Number(votado.bpm || 0));
  if (difBpm > 5) {
    return false;
  }

  // Exige concordância exata no status de presença de paciente
  if (Boolean(candidato.presenca) !== Boolean(votado.presenca)) {
    return false;
  }

  // Exige concordância exata na ativação do protocolo de Regulação Sensorial
  if (Boolean(candidato.modoCalmaAtivo) !== Boolean(votado.modoCalmaAtivo)) {
    return false;
  }

  // Exige concordância no paciente em atendimento
  if (String(candidato.tagId || '') !== tagVotado) {
    return false;
  }

  // Exige concordância no estado do atuador de Iluminação
  if (String(candidato.iluminacao || '') !== String(votado.iluminacao || '')) {
    return false;
  }

  // Exige concordância no estado do atuador Smart Speaker
  if (String(candidato.smartSpeaker || '') !== String(votado.smartSpeaker || '')) {
    return false;
  }

  // Exige concordância no texto do atuador Visor da Porta
  if (String(candidato.displayPorta || '') !== String(votado.displayPorta || '')) {
    return false;
  }

  // Voto validado como íntegro e congruente com o estado candidato
  return true;
}

// Função auxiliar que publica os comandos validados nos 3 tópicos MQTT dos atuadores físicos
export function publicarComandosAtuadores(mqttClient: MqttClient, estado: EstadoSala, origem: string): void {
  // Publica comando de cor/intensidade no tópico do atuador de Iluminação RGB
  mqttClient.publish(
    'clinica/sala1/comando/luz',
    JSON.stringify({ cor: estado.iluminacao, origem }),
    { qos: 0 }
  );
  // Publica comando de faixa sonora no tópico do atuador Smart Speaker
  mqttClient.publish(
    'clinica/sala1/comando/som',
    JSON.stringify({ som: estado.smartSpeaker, origem }),
    { qos: 0 }
  );
  // Publica comando de texto no tópico do atuador Visor da Porta
  mqttClient.publish(
    'clinica/sala1/comando/display',
    JSON.stringify({ mensagem: estado.displayPorta, origem }),
    { qos: 0 }
  );
}
