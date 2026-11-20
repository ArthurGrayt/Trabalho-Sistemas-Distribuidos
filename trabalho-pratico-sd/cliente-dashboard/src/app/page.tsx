// Diretiva obrigatória do Next.js App Router para executar este componente no cliente
'use client';

// Importa os hooks essenciais do React para estado, efeitos e memoização
import React, { useState, useEffect, useCallback, useMemo } from 'react';
// Importa o componente Link do Next.js para acesso rápido à rota do Simulador Mobile (/simulador)
import Link from 'next/link';

// Interface que descreve a estrutura dos registros históricos persistidos no MongoDB de cada controlador
interface RegistroHistorico {
  // Data e hora no formato ISO 8601 da gravação do evento
  horario: string;
  // Categoria de classificação da operação (TELEMETRIA, INVOCACAO_METODO, CONSENSO)
  tipo: string;
  // Detalhe descritivo legível sobre a alteração ocorrida
  descricao: string;
}

// Interface que define o modelo de estado distribuído da Sala 1 da clínica
interface EstadoSala {
  // Nível de ruído acústico ambiente medido em decibéis
  ruidoDb: number;
  // Batimentos cardíacos por minuto monitorados no paciente
  bpm: number;
  // Indicador se há uma criança presente na sala de atendimento
  presenca: boolean;
  // Identificador do paciente enviado pelo Simulador Mobile (/simulador)
  tagId: string;
  // Música favorita do paciente enviada pelo Simulador Mobile (/simulador)
  musicaFavorita?: string;
  // Cor favorita para iluminação enviada pelo Simulador Mobile (/simulador)
  corFavorita?: string;
  // Estado e cor atual do sistema de iluminação
  iluminacao: string;
  // Nome do efeito sonoro ou trilha tocada no Smart Speaker
  smartSpeaker: string;
  // Texto renderizado no display informativo na porta da sala
  displayPorta: string;
  // Booleano sinalizando se o protocolo terapêutico de calma está acionado
  modoCalmaAtivo: boolean;
  // Timestamp limite para comandos manuais sobreporem leituras automáticas
  overrideManualAte?: number;
  // Data e hora ISO da mais recente sincronização
  ultimaAtualizacao: string;
  // Lista de eventos persistidos na instância MongoDB do controlador
  historico?: RegistroHistorico[];
}

// Interface para o resumo individual de saúde de um nó retornado pelo Gateway gRPC (/api/status)
interface NoClusterApi {
  // Identificador do controlador (ex: controlador-1)
  id: string;
  // Rótulo de exibição do nó
  nome: string;
  // Porta gRPC onde o nó responde
  porta: number;
  // Rota proxy no Gateway Next.js
  url: string;
  // Status real de conectividade gRPC do controlador
  online: boolean;
  // Integridade declarada (LIDER_HONESTO, HONESTO, LIDER_INTERINO, FALHA_BIZANTINA ou OFFLINE)
  integridade: string;
  // Identificador da instância MongoDB associada ao nó
  armazenamentoId?: string;
}

// Interface para a resposta entregue pela rota Gateway gRPC /api/status
interface RespostaControlador {
  // Identificador nominal do nó controlador (ex: controlador-1)
  controlador: string;
  // Porta gRPC onde o nó responde chamadas RPC
  porta: number;
  // Identificador da instância MongoDB associada a este nó
  armazenamentoId?: string;
  // Integridade declarada pelo nó (LIDER_HONESTO, HONESTO, LIDER_INTERINO ou FALHA_BIZANTINA)
  integridade: string;
  // Estado completo da sala mantido por este nó
  estado: EstadoSala;
  // Porta que respondeu ao failover no Gateway gRPC
  obtidoViaFailoverNaPorta?: number;
  // Diagnóstico real dos 3 nós consultados pelo Gateway gRPC
  cluster?: NoClusterApi[];
  // Flag indicando se todas as réplicas íntegras do cluster estão inacessíveis
  clusterIndisponivel?: boolean;
}

// Interface para o diagnóstico e situação de consenso de cada réplica exibida na UI
interface StatusNoControlador {
  // Rótulo de exibição do nó
  nome: string;
  // URL base de rota no Gateway gRPC
  url: string;
  // Porta de comunicação gRPC
  porta: number;
  // Flag real informando se o nó respondeu à última chamada gRPC
  online: boolean;
  // Integridade reportada pelo nó
  integridade?: string;
  // Descrição do armazenamento real retornado pelo controlador (MongoDB conectado ou Fallback RAM)
  armazenamentoId?: string;
  // Classificação do voto deste nó no consenso de backend
  statusConsenso: 'CONSENSO_MAIORIA' | 'DESCARTADO_BIZANTINO' | 'OFFLINE';
  // Objeto de dados entregue pelo controlador caso online
  dados?: RespostaControlador;
}

// Lista imutável com os nós de middleware que formam a topologia do cluster gRPC
const CONTROLADORES_CONFIG = [
  // Nó primário do cluster na porta 3001 conectado via Gateway gRPC
  { nome: 'Controlador 1', porta: 3001, url: '/api/controlador/1' },
  // Nó secundário para failover automático na porta 3002 via Gateway gRPC
  { nome: 'Controlador 2', porta: 3002, url: '/api/controlador/2' },
  // Nó com simulação de erro/invasão bizantina na porta 3003 via Gateway gRPC
  { nome: 'Controlador 3', porta: 3003, url: '/api/controlador/3' },
];

// Presets terapêuticos rápidos padronizados nas 4 combinações clínicas do sistema
const PRESETS_TERAPEUTICOS = [
  // 1. Protocolo de Regulação
  {
    // Identificador único do modo
    id: 'regulacao',
    // Nome no Botão: Regulação Sensorial
    nome: 'Regulação Sensorial',
    // Descrição informativa do protocolo
    descricao: 'Protocolo de Regulação Sensorial para acalmar a criança',
    // Ícone representativo
    icone: '💤',
    // Card Iluminação: Azul / Calmante
    cor: 'Azul / Calmante',
    // Card Smart Speaker: Frequência Calmante (Ruído Branco)
    som: 'Frequência Calmante (Ruído Branco)',
    // Card Visor da Porta: > Regulação em Curso (Não Entre)
    display: '> Regulação em Curso (Não Entre)',
    // Estilo de borda no hover
    corBorda: 'hover:border-blue-500/50',
    // Estilo do card quando ativo
    corAtiva: 'border-blue-500/60 bg-blue-950/20',
  },
  // 2. Sessão Lúdica (Para Terapia Ocupacional e interação motora)
  {
    // Identificador único do modo
    id: 'ludico',
    // Nome no Botão: Integração Lúdica
    nome: 'Integração Lúdica',
    // Descrição informativa do protocolo
    descricao: 'Terapia Ocupacional e interação motora com iluminação viva',
    // Ícone representativo
    icone: '🌿',
    // Card Iluminação: Verde / Viva
    cor: 'Verde / Viva',
    // Card Smart Speaker: Sons da Natureza
    som: 'Sons da Natureza',
    // Card Visor da Porta: > Sessão Lúdica em Andamento
    display: '> Sessão Lúdica em Andamento',
    // Estilo de borda no hover
    corBorda: 'hover:border-emerald-500/50',
    // Estilo do card quando ativo
    corAtiva: 'border-emerald-500/60 bg-emerald-950/20',
  },
  // 3. Foco Dirigido (Fonoaudiologia e Psicopedagogia)
  {
    // Identificador único do modo
    id: 'foco',
    // Nome no Botão: Foco Dirigido
    nome: 'Foco Dirigido',
    // Descrição informativa do protocolo
    descricao: 'Foco Dirigido para Fonoaudiologia e Psicopedagogia com alto contraste',
    // Ícone representativo
    icone: '🎯',
    // Card Iluminação: Branca / Alto Contraste
    cor: 'Branca / Alto Contraste',
    // Card Smart Speaker: Isolamento Acústico
    som: 'Isolamento Acústico',
    // Card Visor da Porta: > Sessão de Foco (Silêncio)
    display: '> Sessão de Foco (Silêncio)',
    // Estilo de borda no hover
    corBorda: 'hover:border-zinc-500/50',
    // Estilo do card quando ativo
    corAtiva: 'border-zinc-600 bg-zinc-900/60',
  },
  // 4. Ambiente Personalizado (Linkado com a tela do simulador dos alunos)
  {
    // Identificador único do modo
    id: 'personalizado',
    // Nome no Botão: Perfil do Paciente
    nome: 'Perfil do Paciente',
    // Descrição informativa do protocolo
    descricao: 'Ambiente Personalizado sincronizado com os dados do smartphone do aluno',
    // Ícone representativo
    icone: '🎧',
    // Card Iluminação: Cor Favorita (Dinâmica)
    cor: 'Cor Favorita (Dinâmica)',
    // Card Smart Speaker: Playlist do Paciente (Variável dinâmica vinda do celular)
    som: 'Playlist do Paciente',
    // Card Visor da Porta: > Em Atendimento (Nome da Criança vindo do celular)
    display: '> Em Atendimento',
    // Estilo de borda no hover
    corBorda: 'hover:border-purple-500/50',
    // Estilo do card quando ativo
    corAtiva: 'border-purple-500/60 bg-purple-950/20',
  },
];

// Componente visual principal da aplicação Next.js
export default function DashboardPage() {
  // Estado que seleciona qual cliente está operando o painel (Cliente 1 ou 2)
  const [identificacaoCliente, setIdentificacaoCliente] = useState<string>('Cliente 1');
  // Estado do estado consensual validado pela maioria (Quorum)
  const [estadoConsenso, setEstadoConsenso] = useState<EstadoSala | null>(null);
  // Lista com o estado de saúde e respostas de cada um dos 3 nós
  const [nosControladores, setNosControladores] = useState<StatusNoControlador[]>([]);
  // Mensagem textual de resumo do Quorum
  const [resumoQuorum, setResumoQuorum] = useState<string>('Conectando ao cluster...');
  // Fila de registros no console de auditoria e tolerância a falhas
  const [logsAuditoria, setLogsAuditoria] = useState<{ id: string; horario: string; tipo: string; mensagem: string }[]>([]);
  // Indicador de requisição HTTP remota em execução
  const [enviandoComando, setEnviandoComando] = useState<boolean>(false);
  // Filtro de categorias do log de auditoria incluindo aba dedicada ao histórico persistido no MongoDB
  const [filtroLog, setFiltroLog] = useState<'TODOS' | 'FAILOVER' | 'METODO' | 'HISTORICO_DB'>('TODOS');

  // Campo de cor no formulário customizado
  const [corCustom, setCorCustom] = useState<string>('azul/calma');
  // Campo de som no formulário customizado
  const [somCustom, setSomCustom] = useState<string>('ruído branco');
  // Campo de texto no visor da porta no formulário customizado
  const [displayCustom, setDisplayCustom] = useState<string>('Modo Calma Ativo');

  // Adiciona entrada estruturada no histórico de eventos do painel
  const registrarLog = useCallback((tipo: 'INFO' | 'FAILOVER' | 'METODO' | 'ALERTA', mensagem: string) => {
    // Formata o horário atual em HH:MM:SS
    const horario = new Date().toLocaleTimeString('pt-BR');
    // Cria identificador pseudoaleatório
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    // Adiciona na frente e limita a lista em 25 eventos
    setLogsAuditoria((prev) => [{ id, horario, tipo, mensagem }, ...prev.slice(0, 24)]);
  }, []);

  // Faz requisições HTTP seguras com temporizador de cancelamento (timeout)
  const fetchComTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 1500): Promise<Response> => {
    // Cria o controlador de aborto nativo do navegador
    const controller = new AbortController();
    // Agenda o acionamento do cancelamento caso o nó não responda no prazo
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Dispara a requisição fetch repassando o signal de cancelamento
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        cache: 'no-store',
      });
      // Devolve a resposta bem-sucedida
      return response;
    } finally {
      // Desativa o temporizador imediatamente após a resposta
      clearTimeout(timer);
    }
  };

  // Rotina de consulta ao estado validado no Backend e saúde real dos 3 nós via Gateway gRPC
  const consultarQuorumControladores = useCallback(async () => {
    try {
      // Consulta /api/status que retorna o estado consolidado + diagnóstico real dos 3 controladores
      const res = await fetchComTimeout('/api/status', { method: 'GET' }, 1800);
      const dadosLider: RespostaControlador = await res.json().catch(() => ({} as RespostaControlador));

      // Atualiza o diagnóstico visual dos 3 nós usando os dados reais retornados pelo Gateway gRPC
      const clusterReal = Array.isArray(dadosLider?.cluster) ? dadosLider.cluster : [];
      if (clusterReal.length > 0) {
        // Mapeia cada nó reportado pelo backend para o formato exibido no card lateral
        const diagnostico: StatusNoControlador[] = clusterReal.map((no) => {
          // Determina o rótulo dinâmico conforme o papel atual (Líder, Líder Interino ou Réplica)
          const rotulo =
            no.porta === 3001
              ? 'Controlador 1 (Líder)'
              : no.porta === 3002
              ? no.integridade === 'LIDER_INTERINO'
                ? 'Controlador 2 (Líder Interino)'
                : 'Controlador 2 (Réplica)'
              : no.integridade === 'LIDER_INTERINO'
              ? 'Controlador 3 (Líder Interino)'
              : no.integridade === 'HONESTO'
              ? 'Controlador 3 (Honesto)'
              : 'Controlador 3 (Bizantino)';

          // Classifica o status de consenso com base na conectividade real e integridade declarada
          const statusConsenso: StatusNoControlador['statusConsenso'] = !no.online
            ? 'OFFLINE'
            : no.integridade === 'FALHA_BIZANTINA'
            ? 'DESCARTADO_BIZANTINO'
            : 'CONSENSO_MAIORIA';

          return {
            nome: rotulo,
            url: no.url,
            porta: no.porta,
            online: Boolean(no.online),
            integridade: no.integridade,
            // Repassa o status real de armazenamento (MongoDB conectado ou Fallback RAM) reportado pelo nó
            armazenamentoId: no.armazenamentoId,
            statusConsenso,
            dados: no.porta === dadosLider.obtidoViaFailoverNaPorta ? dadosLider : undefined,
          };
        });

        setNosControladores(diagnostico);

        // Calcula o texto exato do resumo do cluster de acordo com o estado real das réplicas
        const no1 = clusterReal.find((n) => n.porta === 3001);
        const no2 = clusterReal.find((n) => n.porta === 3002);
        const no3 = clusterReal.find((n) => n.porta === 3003);

        if (!res.ok || dadosLider?.clusterIndisponivel) {
          // Sinaliza indisponibilidade se nenhum nó íntegro respondeu
          setResumoQuorum('Cluster indisponível — Nenhum controlador íntegro acessível.');
        } else if (!no1?.online && !no2?.online && no3?.online && no3?.integridade !== 'FALHA_BIZANTINA') {
          // Destaca a assunção de C3 como líder interino de contingência máxima
          setResumoQuorum('Failover de 2º Nível Ativo — Controlador 3 operando como Líder Interino (C1 e C2 offline).');
        } else if (!no1?.online && no2?.online) {
          // Destaca failover para C2
          setResumoQuorum('Failover Ativo — Controlador 2 operando como Líder Interino.');
        } else if (no3?.online && no3?.integridade === 'FALHA_BIZANTINA') {
          // Quorum 2x1 com descarte de voto bizantino
          setResumoQuorum('Quorum 2x1 Validado no Backend — Voto bizantino do Nó 3 descartado pelo Líder.');
        } else if (no1?.online && no2?.online && no3?.online) {
          // Todos os 3 nós íntegros
          setResumoQuorum('Consenso Unânime (3/3) — 3 réplicas íntegras sincronizadas no Backend.');
        } else if (no1?.online && (no2?.online || no3?.online)) {
          // Quorum parcial
          setResumoQuorum('Quorum 2x1 Validado no Backend — Cluster operando com contingência parcial.');
        } else {
          // Caso degradado
          setResumoQuorum('Cluster degradado — Menos de 2 nós íntegros disponíveis.');
        }
      }

      // Interrompe a atualização do estado caso nenhum controlador esteja disponível
      if (!res.ok || dadosLider?.clusterIndisponivel) return;

      // Atualiza o estado da sala diretamente com os dados validados no Backend
      if (dadosLider && dadosLider.estado) {
        setEstadoConsenso(dadosLider.estado);
      }
    } catch {
      // Em falha total de rede com o Gateway, marca todos os nós como offline
      setNosControladores((prev) =>
        prev.length > 0
          ? prev.map((n) => ({ ...n, online: false, statusConsenso: 'OFFLINE' }))
          : CONTROLADORES_CONFIG.map((cfg) => ({
              nome: cfg.nome,
              url: cfg.url,
              porta: cfg.porta,
              online: false,
              statusConsenso: 'OFFLINE',
            }))
      );
      setResumoQuorum('Cluster indisponível — Todos os controladores estão offline.');
    }
  }, []);

  // Hook useEffect que inicializa e mantém o ciclo de sincronização em tempo real (500ms) com o Simulador Mobile
  useEffect(() => {
    // Primeira execução imediata
    consultarQuorumControladores();
    // Temporizador a cada 500ms para refletir instantaneamente os valores do /simulador
    const timer = setInterval(() => {
      consultarQuorumControladores();
    }, 500);
    // Limpeza ao desmontar componente
    return () => clearInterval(timer);
  }, [consultarQuorumControladores]);

  // Executa o acionamento manual do Modo Calma com tolerância a falhas (Failover C1 -> C2 -> C3)
  const ativarModoCalmaManualmente = async () => {
    setEnviandoComando(true);
    registrarLog('METODO', `[${identificacaoCliente}] Invocando ativarModoCalmaManual() no Controlador 1 (:3001)...`);
    // Prepara payload identificando qual perfil cliente (Cliente 1 / Cliente 2) disparou a ação remota
    const bodyOrigem = JSON.stringify({ origem: identificacaoCliente });

    // 1ª Tentativa no nó primário (Controlador 1 via gRPC)
    try {
      const res1 = await fetchComTimeout(
        '/api/controlador/1/modo-calma',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodyOrigem },
        1500
      );
      if (!res1.ok) throw new Error(`HTTP ${res1.status}`);
      registrarLog('INFO', `Método executado com sucesso no Controlador Primário 1 (:3001) via gRPC (${identificacaoCliente})`);
      await consultarQuorumControladores();
      setEnviandoComando(false);
      return;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha';
      registrarLog('FAILOVER', `Controlador 1 offline (${msg}). Acionando Failover para Controlador 2 (:3002)...`);
    }

    // 2ª Tentativa no nó secundário (Controlador 2 via gRPC)
    try {
      const res2 = await fetchComTimeout(
        '/api/controlador/2/modo-calma',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodyOrigem },
        1500
      );
      if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
      registrarLog('INFO', `Failover concluído com sucesso via Controlador 2 (:3002) via gRPC (${identificacaoCliente})`);
      await consultarQuorumControladores();
      setEnviandoComando(false);
      return;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha';
      registrarLog('FAILOVER', `Controlador 2 offline (${msg}). Redirecionando para Controlador 3 (:3003)...`);
    }

    // 3ª Tentativa no nó terciário (Controlador 3 via gRPC)
    try {
      const res3 = await fetchComTimeout(
        '/api/controlador/3/modo-calma',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodyOrigem },
        1500
      );
      const dados3 = await res3.json().catch(() => ({}));
      if (!res3.ok || dados3?.sucesso === false) {
        throw new Error(dados3?.mensagem || `HTTP ${res3.status}`);
      }
      registrarLog('INFO', `Contingência executada no Controlador 3 (:3003) via gRPC (${identificacaoCliente})`);
      await consultarQuorumControladores();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nenhuma réplica disponível';
      registrarLog('ALERTA', `Falha total ao ativar modo calma: ${msg}.`);
    } finally {
      setEnviandoComando(false);
    }
  };

  // Invocação remota orientada a objetos (configurarAtuadores) com Failover automático
  const invocarConfiguracaoAtuadores = async (parametrosPersonalizados?: { cor?: string; som?: string; display?: string }) => {
    setEnviandoComando(true);

    // Constrói o corpo da mensagem com o método a ser invocado
    const payload = JSON.stringify({
      metodo: 'configurarAtuadores',
      origem: identificacaoCliente,
      parametros: {
        corLuz: parametrosPersonalizados?.cor ?? corCustom,
        somSpeaker: parametrosPersonalizados?.som ?? somCustom,
        textoDisplay: parametrosPersonalizados?.display ?? displayCustom,
      },
    });

    // Percorre os controladores em ordem de prioridade até conseguir executar
    for (const cfg of CONTROLADORES_CONFIG) {
      try {
        registrarLog('METODO', `[${identificacaoCliente}] Invocando objeto.configurarAtuadores() em ${cfg.nome}...`);
        const res = await fetchComTimeout(
          `${cfg.url}/invocar-metodo`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          },
          1500
        );
        const dadosRes = await res.json().catch(() => ({}));
        if (!res.ok || dadosRes?.sucesso === false) {
          throw new Error(dadosRes?.mensagem || `HTTP ${res.status}`);
        }
        registrarLog('INFO', `Método executado com êxito através de ${cfg.nome} (${identificacaoCliente})`);
        await consultarQuorumControladores();
        setEnviandoComando(false);
        return;
      } catch {
        registrarLog('FAILOVER', `${cfg.nome} indisponível. Repassando chamada para a próxima réplica...`);
      }
    }

    registrarLog('ALERTA', 'Falha: nenhum controlador disponível para executar a invocação.');
    setEnviandoComando(false);
  };

  // Aplica um preset clínico e dispara a chamada remota imediatamente com suporte a variáveis do paciente
  const acionarPreset = (preset: typeof PRESETS_TERAPEUTICOS[0]) => {
    // Obtém o nome da música favorita vindo do simulador ou valor padrão lúdico
    const musicaPaciente =
      estadoConsenso?.musicaFavorita && estadoConsenso.musicaFavorita !== 'Aguardando paciente'
        ? estadoConsenso.musicaFavorita
        : 'Rock';

    // Obtém o nome da criança vindo do simulador ou valor padrão
    const nomePaciente =
      estadoConsenso?.tagId && estadoConsenso.tagId !== 'Nenhum paciente'
        ? estadoConsenso.tagId
        : 'Lucas';

    // Obtém a cor favorita real do paciente ou utiliza 'Azul' como fallback seguro
    const corPaciente =
      estadoConsenso?.corFavorita && estadoConsenso.corFavorita !== 'Branco'
        ? estadoConsenso.corFavorita
        : 'Azul';

    // Determina a cor da iluminação a ser configurada (usando cor favorita real no perfil personalizado)
    const corFinal =
      preset.id === 'personalizado' ? `Cor Favorita (${corPaciente})` : preset.cor;

    // Determina o som (no perfil personalizado, inclui a variável da música do paciente)
    const somFinal =
      preset.id === 'personalizado'
        ? `Playlist do Paciente (${musicaPaciente})`
        : preset.som;

    // Determina a mensagem da porta (no perfil personalizado, inclui a variável do nome do paciente)
    const displayFinal =
      preset.id === 'personalizado'
        ? `> Em Atendimento (${nomePaciente})`
        : preset.display;

    // Atualiza os estados locais auxiliares
    setCorCustom(corFinal);
    // Atualiza o som local
    setSomCustom(somFinal);
    // Atualiza o display local
    setDisplayCustom(displayFinal);

    // Se for o protocolo de regulação, invoca o método de regulação com failover
    if (preset.id === 'regulacao') {
      ativarModoCalmaManualmente();
    } else {
      // Dispara a invocação remota do método com os parâmetros resolvidos
      invocarConfiguracaoAtuadores({ cor: corFinal, som: somFinal, display: displayFinal });
    }
  };

  // Liga ou desliga a simulação de falha bizantina no Controlador 3 lendo o retorno tipado do gRPC
  const alternarModoBizantino = async () => {
    try {
      const res = await fetchComTimeout('/api/controlador/3/toggle-bizantino', { method: 'POST' }, 1500);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dados = await res.json();
      // Usa o campo booleano simularFalhaBizantina retornado por SucessoResponse (com fallback na mensagem)
      const ativo =
        typeof dados?.simularFalhaBizantina === 'boolean'
          ? dados.simularFalhaBizantina
          : String(dados?.mensagem || '').includes('ATIVO');
      registrarLog(
        'INFO',
        `Simulação no Controlador 3 alterada: ${
          ativo ? 'Falha Bizantina Ativada' : 'Modo Honesto Restaurado'
        }`
      );
      await consultarQuorumControladores();
    } catch {
      registrarLog('ALERTA', 'Não foi possível alternar simulação: Controlador 3 está offline.');
    }
  };

  // Alterna o status operacional (Crash ou Recovery) de qualquer um dos 3 nós do cluster
  const alternarStatusNo = async (no: StatusNoControlador) => {
    // Bloco try/catch para captura de erros de rede
    try {
      // Extrai o identificador ordinal do nó a partir da porta (3001 -> 1, 3002 -> 2, 3003 -> 3)
      const idOrdinal = no.porta === 3001 ? '1' : no.porta === 3002 ? '2' : '3';
      // Registra no log a intenção da operação antes de disparar
      registrarLog('INFO', `Enviando comando para alternar status operacional de ${no.nome}...`);
      // Dispara a requisição HTTP POST para a rota do Gateway
      const res = await fetchComTimeout(`/api/controlador/${idOrdinal}/toggle-crash`, { method: 'POST' }, 2500);
      // Tenta obter o corpo JSON retornado pela API
      const dados = await res.json().catch(() => ({}));
      // Verifica se a resposta HTTP foi de erro crítico (diferente de 503)
      if (!res.ok && res.status !== 503) {
        // Lança erro caso a API tenha retornado status de falha
        throw new Error(dados?.erro || `HTTP ${res.status}`);
      }
      // Verifica se o nó estava online antes do comando
      const estavaOnline = no.online;
      // Registra mensagem de auditoria no console com o evento correspondente
      registrarLog(
        estavaOnline ? 'FAILOVER' : 'INFO',
        estavaOnline
          ? `💀 [FALHA DE PARADA / CRASH] ${no.nome} foi derrubado! Observe a reação do cluster.`
          : `⚡ [RECUPERAÇÃO / RECOVERY] ${no.nome} foi revivido e sincronizado com o cluster!`
      );
      // Força nova consulta imediata do estado de consenso e diagnóstico de todos os nós
      await consultarQuorumControladores();
    } catch (err: any) {
      // Registra alerta no log caso haja falha inesperada na chamada
      registrarLog('ALERTA', `Erro ao alternar status de ${no.nome}: ${err?.message || 'Falha de comunicação'}`);
    }
  };

  // Dispara a configuração padrão do Cenário 1: Operação Normal com Quorum 2x1 ativo
  const dispararCenario1 = async () => {
    // Localiza os diagnósticos atuais dos nós 1 e 2
    const no1 = nosControladores.find((n) => n.porta === 3001);
    // Localiza o nó 2
    const no2 = nosControladores.find((n) => n.porta === 3002);
    // Se o Controlador 1 estiver offline, reativa-o
    if (no1 && !no1.online) {
      // Envia comando para reviver C1
      await fetchComTimeout('/api/controlador/1/toggle-crash', { method: 'POST' }, 2500);
    }
    // Se o Controlador 2 estiver offline, reativa-o
    if (no2 && !no2.online) {
      // Envia comando para reviver C2
      await fetchComTimeout('/api/controlador/2/toggle-crash', { method: 'POST' }, 2500);
    }
    // Registra no console de auditoria
    registrarLog('INFO', '🟢 [CENÁRIO 1] Operação Normal restaurada: C1 Líder ativo, C2 Réplica Honesta e Quorum 2x1 funcionando.');
    // Atualiza o estado visual do cluster
    await consultarQuorumControladores();
  };

  // Dispara o Cenário 2: Queda do Líder C1 e promoção automática de C2 como Líder Interino
  const dispararCenario2 = async () => {
    // Localiza o diagnóstico do Nó 1
    const no1 = nosControladores.find((n) => n.porta === 3001);
    // Se o Controlador 1 estiver online, derruba-o para disparar a eleição/failover
    if (no1 && no1.online) {
      // Envia requisição para derrubar o Controlador 1
      await fetchComTimeout('/api/controlador/1/toggle-crash', { method: 'POST' }, 2500);
      // Registra o evento de failover no log
      registrarLog('FAILOVER', '👑 [CENÁRIO 2] Queda do Líder C1 simulada! C2 detectará heartbeat em 1.5s e assumirá como Líder Interino.');
    } else {
      // Alerta que C1 já estava caído
      registrarLog('FAILOVER', '👑 [CENÁRIO 2] C1 já se encontra offline. Controlador 2 já opera como Líder Interino.');
    }
    // Atualiza a telemetria do cluster
    await consultarQuorumControladores();
  };

  // Dispara o Cenário 3: Recuperação de C1 com Catch-up automático junto a C2 e devolução pacífica
  const dispararCenario3 = async () => {
    // Localiza o diagnóstico do Nó 1
    const no1 = nosControladores.find((n) => n.porta === 3001);
    // Se o Controlador 1 estiver offline, revigora o processo disparando o catch-up
    if (no1 && !no1.online) {
      // Envia requisição para reviver o Controlador 1
      await fetchComTimeout('/api/controlador/1/toggle-crash', { method: 'POST' }, 2500);
      // Registra no log de auditoria
      registrarLog('INFO', '🔄 [CENÁRIO 3] C1 revivido! Catch-up automático disparado com C2; liderança íntegra reassumida.');
    } else {
      // Informa que C1 já está operando
      registrarLog('INFO', '🔄 [CENÁRIO 3] C1 já está online e operando em modo íntegro.');
    }
    // Atualiza a visão do cluster
    await consultarQuorumControladores();
  };

  // Identifica dinamicamente qual dos 3 cenários distribuídos está em vigor neste instante
  const cenarioAtivo = useMemo(() => {
    // Obtém o nó 1
    const no1 = nosControladores.find((n) => n.porta === 3001);
    // Obtém o nó 2
    const no2 = nosControladores.find((n) => n.porta === 3002);
    // Obtém o nó 3
    const no3 = nosControladores.find((n) => n.porta === 3003);
    // Caso C1 e C2 estejam fora e C3 online e honesto -> Cenário 2 (Failover de 2º Nível para C3)
    if (!no1?.online && !no2?.online && no3?.online && no3?.integridade !== 'FALHA_BIZANTINA') {
      // Retorna 2 para indicar Cenário 2 (Failover Ativo)
      return 2;
    }
    // Caso C1 esteja fora e C2 online, estamos no Cenário 2 (Failover / Líder Interino C2)
    if (no1 && !no1.online && no2 && no2.online) {
      // Retorna 2 para indicar Cenário 2
      return 2;
    }
    // Caso C1 e C2 estejam online, o cluster está no Cenário 1 (Operação Normal)
    if (no1 && no1.online && no2 && no2.online) {
      // Retorna 1 para indicar Cenário 1
      return 1;
    }
    // Caso C1 esteja online mas C2 fora, ou retorno recente de C1
    if (no1 && no1.online) {
      // Retorna 3 para indicar Cenário 3 / Recuperação
      return 3;
    }
    // Caso todos estejam fora
    return 0;
  }, [nosControladores]);

  // Formata timestamps ISO retornados pelo MongoDB para HH:MM:SS em pt-BR com fallback seguro
  const formatarHorarioRegistro = (horarioIso: string): string => {
    // Tenta converter a string ISO recebida para timestamp numérico
    const data = new Date(horarioIso);
    // Retorna o horário formatado se a data for válida, ou o texto original caso contrário
    return Number.isNaN(data.getTime()) ? horarioIso : data.toLocaleTimeString('pt-BR');
  };

  // Filtra as mensagens exibidas no terminal de logs
  const logsApresentados = useMemo(() => {
    if (filtroLog === 'TODOS') return logsAuditoria;
    return logsAuditoria.filter((l) => l.tipo === filtroLog);
  }, [logsAuditoria, filtroLog]);

  // Contagem de nós ativos
  const nosOnlineCount = nosControladores.filter((n) => n.online).length;
  // Identifica se há nó bizantino divergente ativo
  const temBizantinoAtivo = nosControladores.some((n) => n.online && n.statusConsenso === 'DESCARTADO_BIZANTINO');

  // Renderização da interface limpa, sóbria e intuitiva
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* Barra de Navegação Superior (Header Limpo e Funcional) */}
      <header className="border-b border-zinc-800/80 bg-zinc-900/40 backdrop-blur sticky top-0 z-30 px-4 sm:px-6 py-3">
        <div className="mx-auto max-w-7xl flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          {/* Lado Esquerdo: Identidade do Sistema e Sala */}
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-zinc-800 border border-zinc-700/80 flex items-center justify-center font-bold text-xs text-zinc-100">
              DT
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-zinc-100 tracking-tight">Diverterapia</span>
                <span className="text-zinc-600">/</span>
                <span className="text-xs font-medium text-zinc-400">Sala 01 Pediátrica</span>
              </div>
            </div>
          </div>

          {/* Centro: Seletor de Perfil do Cliente (Cliente 1 / Cliente 2 da Figura 1) */}
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/90 p-1 self-start md:self-auto">
            <button
              type="button"
              onClick={() => setIdentificacaoCliente('Cliente 1')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                identificacaoCliente === 'Cliente 1'
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Cliente 1 (Médico)
            </button>
            <button
              type="button"
              onClick={() => setIdentificacaoCliente('Cliente 2')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                identificacaoCliente === 'Cliente 2'
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Cliente 2 (Enfermagem)
            </button>
          </div>

          {/* Lado Direito: Ações Principais e Indicadores Rápidos */}
          <div className="flex items-center gap-2.5 self-end md:self-auto">
            {/* Atalho Rápido para o Simulador Mobile (/simulador) */}
            <Link
              href="/simulador"
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition"
            >
              📱 Simulador Mobile
            </Link>

            {/* Botão de Toggle da Falha Bizantina no Nó 3 */}
            <button
              type="button"
              onClick={alternarModoBizantino}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition flex items-center gap-1.5 ${
                temBizantinoAtivo
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${temBizantinoAtivo ? 'bg-amber-400 animate-pulse' : 'bg-zinc-600'}`} />
              <span>{temBizantinoAtivo ? 'Falha Bizantina Ativa' : 'Simular Ataque/Falha'}</span>
            </button>

           
          </div>
        </div>
      </header>

      {/* Conteúdo Central da Aplicação */}
      <main className="mx-auto max-w-7xl w-full px-4 sm:px-6 py-6 flex-1 space-y-6">
        {/* Banner de Estado Clínico da Sala e Consenso (Hero Status) */}
        <div
          className={`rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 transition ${
            nosOnlineCount === 0
              ? 'border-rose-500/40 bg-rose-950/20 text-rose-200'
              : nosControladores.some((n) => n.integridade === 'LIDER_INTERINO')
              ? 'border-blue-500/40 bg-blue-950/20 text-blue-200'
              : temBizantinoAtivo
              ? 'border-amber-500/40 bg-amber-950/20 text-amber-200'
              : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-200'
          }`}
        >
          {/* Lado Esquerdo: Indicador pulsante e texto do consenso atual */}
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                nosOnlineCount === 0
                  ? 'bg-rose-400'
                  : nosControladores.some((n) => n.integridade === 'LIDER_INTERINO')
                  ? 'bg-blue-400 animate-pulse'
                  : temBizantinoAtivo
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-emerald-400 animate-pulse'
              }`}
            />
            <span className="text-xs font-medium tracking-tight truncate">{resumoQuorum}</span>
          </div>
          {/* Lado Direito: Contagem real de nós gRPC online no cluster */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-md border border-white/10 bg-black/25">
              {nosOnlineCount}/3 nós gRPC online
            </span>
          </div>
        </div>

      

        {/* Layout Principal em 2 Colunas com proporção ajustada (+15% na coluna esquerda) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Coluna Esquerda ampliada para 8 de 12 colunas (~66.7% vs 33.3% da direita, aumento de 15% em relação aos 7/12 anteriores) */}
          <div className="lg:col-span-8 space-y-6">
            {/* Bloco 1: Telemetria em Tempo Real sincronizada com o Simulador Mobile (/simulador) */}
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800/60 pb-3">
                <div>
                  <h2 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                    Telemetria dos Sensores (simulador)
                  </h2>
                </div>
              </div>

              {/* Grid dos 3 Sensores */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Sensor 1: Ruído (40 a 120 dB idêntico ao Simulador Mobile) */}
                <div className={`p-3.5 rounded-lg border transition ${
                  (estadoConsenso?.ruidoDb ?? 0) > 85
                    ? 'border-rose-500/40 bg-rose-950/20'
                    : 'border-zinc-800/80 bg-zinc-900/60'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-zinc-400">Ruído Ambiente</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      (estadoConsenso?.ruidoDb ?? 0) > 85 ? 'bg-rose-500/20 text-rose-300' : 'text-zinc-400'
                    }`}>
                      {(estadoConsenso?.ruidoDb ?? 0) > 85 ? 'Crítico' : 'Normal'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-2xl font-bold font-mono tracking-tight text-zinc-100 tabular-nums">
                      {estadoConsenso ? estadoConsenso.ruidoDb : '--'}
                    </span>
                    <span className="text-xs text-zinc-500">dB</span>
                  </div>
                  <div className="mt-2.5">
                    <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-200 ${
                          (estadoConsenso?.ruidoDb ?? 0) > 85 ? 'bg-rose-500' : 'bg-zinc-400'
                        }`}
                        style={{ width: `${Math.min(Math.max(((estadoConsenso?.ruidoDb ?? 40) - 40) / 80 * 100, 4), 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-zinc-500 font-mono">
                      <span>40dB</span>
                      <span className="text-zinc-400">Limiar: 85dB</span>
                      <span>120dB</span>
                    </div>
                  </div>
                </div>

                {/* Sensor 2: Batimentos Cardíacos (60 a 160 BPM idêntico ao Simulador Mobile) */}
                <div className={`p-3.5 rounded-lg border transition ${
                  (estadoConsenso?.bpm ?? 0) > 120
                    ? 'border-rose-500/40 bg-rose-950/20'
                    : 'border-zinc-800/80 bg-zinc-900/60'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-zinc-400">Batimentos (BPM)</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      (estadoConsenso?.bpm ?? 0) > 120 ? 'bg-rose-500/20 text-rose-300' : 'text-zinc-400'
                    }`}>
                      {(estadoConsenso?.bpm ?? 0) > 120 ? 'Taquicardia' : 'Normal'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-2xl font-bold font-mono tracking-tight text-zinc-100 tabular-nums">
                      {estadoConsenso ? estadoConsenso.bpm : '--'}
                    </span>
                    <span className="text-xs text-zinc-500">BPM</span>
                  </div>
                  <div className="mt-2.5">
                    <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-200 ${
                          (estadoConsenso?.bpm ?? 0) > 120 ? 'bg-rose-500' : 'bg-zinc-400'
                        }`}
                        style={{ width: `${Math.min(Math.max(((estadoConsenso?.bpm ?? 60) - 60) / 100 * 100, 4), 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-zinc-500 font-mono">
                      <span>60</span>
                      <span className="text-zinc-400">Limiar: 120</span>
                      <span>160</span>
                    </div>
                  </div>
                </div>

                {/* Sensor 3: Paciente na Sala (Exibe exclusivamente o paciente enviado pelo Simulador Mobile) */}
                <div className="p-3.5 rounded-lg border border-zinc-800/80 bg-zinc-900/60 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-zinc-400">Paciente na Sala</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      estadoConsenso?.presenca ? 'bg-emerald-500/15 text-emerald-400' : 'text-zinc-500'
                    }`}>
                      {estadoConsenso?.presenca ? 'Em Atendimento' : 'Sala Livre'}
                    </span>
                  </div>
                  <div className="my-1">
                    <span className="text-lg font-semibold text-zinc-100 block truncate">
                      {estadoConsenso?.presenca ? estadoConsenso.tagId : 'Nenhum paciente'}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-zinc-400 truncate space-y-0.5">
                    {estadoConsenso?.presenca ? (
                      <div className="truncate">
                        Música: <span className="text-zinc-200 font-semibold">{estadoConsenso.musicaFavorita || estadoConsenso.smartSpeaker}</span>
                      </div>
                    ) : (
                      <span>Aguardando entrada via /simulador</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Bloco 2: Atuadores Ambientais e Resposta da Sala */}
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800/60 pb-3">
                <div>
                  <h2 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                    Atuadores Físicos da Sala
                  </h2>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Atuador: Iluminação */}
                <div className="p-3.5 rounded-lg border border-zinc-800/80 bg-zinc-900/60">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>Iluminação</span>
                    <span className="font-mono text-[10px] text-zinc-500">comando/luz</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2.5">
                    <span className={`h-3.5 w-3.5 rounded-full shrink-0 border border-white/20 transition-all ${
                      estadoConsenso?.iluminacao.toLowerCase().includes('azul')
                        ? 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]'
                        : estadoConsenso?.iluminacao.toLowerCase().includes('verde')
                        ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]'
                        : estadoConsenso?.iluminacao.toLowerCase().includes('branca')
                        ? 'bg-zinc-100 shadow-[0_0_8px_rgba(255,255,255,0.4)]'
                        : 'bg-purple-400 shadow-[0_0_8px_rgba(192,132,252,0.5)]'
                    }`} />
                    <span className="text-xs font-medium text-zinc-100 truncate">
                      {estadoConsenso?.iluminacao || 'Aguardando...'}
                    </span>
                  </div>
                </div>

                {/* Atuador: Smart Speaker */}
                <div className="p-3.5 rounded-lg border border-zinc-800/80 bg-zinc-900/60">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>Smart Speaker</span>
                    <span className="font-mono text-[10px] text-zinc-500">comando/som</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-zinc-400">🔊</span>
                    <span className="text-xs font-medium text-zinc-100 truncate">
                      {estadoConsenso?.smartSpeaker || 'Aguardando...'}
                    </span>
                  </div>
                </div>

                {/* Atuador: Display da Porta */}
                <div className="p-3.5 rounded-lg border border-zinc-800/80 bg-zinc-900/60">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>Visor da Porta</span>
                    <span className="font-mono text-[10px] text-zinc-500">comando/display</span>
                  </div>
                  <div className="mt-3">
                    <p className="text-xs font-mono text-zinc-200 truncate">
                      {estadoConsenso?.displayPorta?.startsWith('>') ? estadoConsenso.displayPorta : `> ${estadoConsenso?.displayPorta || 'Sala 1 - Livre'}`}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Bloco 3: Invocação de Métodos Remotos em Layout Compacto Horizontal (Metade da Altura) */}
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-3.5 space-y-2.5">
              {/* Cabeçalho Compacto em Linha Única */}
              <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
                {/* Título e Subtítulo em Linha */}
                <div className="flex items-center gap-2">
                  {/* Título da Seção de Métodos */}
                  <h2 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                    Modos da Sala
                  </h2>
                  {/* Divisor Visual Sutil */}
                  <span className="text-zinc-600 text-xs">•</span>
                  {/* Descrição Compacta da Ação */}
                  <p className="text-[11px] text-zinc-400">
                    Invocação de método em 1 clique com Failover automático
                  </p>
                </div>
                {/* Indicador de Tipo de Comunicação */}
                <span className="hidden sm:inline-block text-[10px] font-mono text-zinc-500">
                  objetoControlador.configurarAtuadores()
                </span>
              </div>

              {/* Grid Horizontal em Linha Única (4 Colunas) para Reduzir a Altura pela Metade */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {/* Mapeamento de Cada Preset Clínico */}
                {PRESETS_TERAPEUTICOS.map((p) => {
                  {/* Identifica se este modo é exatamente o que está ativo no estado de consenso */}
                  const estaAtivo =
                    p.id === 'regulacao'
                      ? estadoConsenso?.modoCalmaAtivo || estadoConsenso?.iluminacao === 'Azul / Calmante'
                      : p.id === 'personalizado'
                      ? (Boolean(estadoConsenso?.iluminacao?.startsWith('Cor Favorita')) ||
                         Boolean(estadoConsenso?.smartSpeaker?.startsWith('Playlist do Paciente'))) &&
                        !estadoConsenso?.modoCalmaAtivo
                      : estadoConsenso?.iluminacao === p.cor && !estadoConsenso?.modoCalmaAtivo;

                  {/* Renderiza o Botão Compacto */}
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => acionarPreset(p)}
                      disabled={enviandoComando}
                      className={`p-2.5 rounded-lg border text-left transition-all duration-150 flex items-center justify-between gap-2 group ${
                        estaAtivo
                          ? `${p.corAtiva} shadow-sm ring-1 ring-white/10`
                          : `border-zinc-800/80 bg-zinc-900/60 hover:bg-zinc-800/60 ${p.corBorda}`
                      } disabled:opacity-60 disabled:cursor-not-allowed`}
                    >
                      {/* Lado Esquerdo com Ícone e Nome do Modo */}
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Ícone Representativo */}
                        <span className="text-sm shrink-0">{p.icone}</span>
                        {/* Bloco de Texto do Modo */}
                        <div className="min-w-0">
                          {/* Nome do Preset */}
                          <p className="text-xs font-semibold text-zinc-200 group-hover:text-white truncate transition">
                            {p.nome}
                          </p>
                          {/* Resumo da Cor/Ação em Linha Fina com Variável Dinâmica para Perfil do Paciente */}
                          <p className="text-[10px] font-mono text-zinc-400 truncate">
                            {p.id === 'personalizado'
                              ? `Playlist (${estadoConsenso?.musicaFavorita && estadoConsenso.musicaFavorita !== 'Aguardando paciente' ? estadoConsenso.musicaFavorita : 'Rock'})`
                              : p.cor.split('/')[0].trim()}
                          </p>
                        </div>
                      </div>

                      {/* Lado Direito com Badge de Ativo ou Indicador de Ação */}
                      <div className="shrink-0">
                        {estaAtivo ? (
                          /* Ponto Indicador Ativo */
                          <span className="h-2 w-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
                        ) : (
                          /* Seta Discreta de Execução */
                          <span className="text-zinc-600 group-hover:text-zinc-300 text-xs transition">
                            &rarr;
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Coluna Direita com restrição rígida de dimensões (min-h-0 e min-w-0 impedem crescimento com logs) */}
          <div className="lg:col-span-4 flex flex-col gap-6 min-h-0 min-w-0">
            {/* Bloco 4: Estado das Réplicas do Middleware e Quorum (Figura 1) com altura natural sem esticar */}
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-5 space-y-3 shrink-0">
              <div className="flex items-center justify-between border-b border-zinc-800/60 pb-3">
                <div>
                  <h2 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                    Réplicas do Middleware 
                  </h2>
                  <p className="text-[11px] text-zinc-500">Consenso por votação - Quórum </p>
                </div>
              </div>

              {/* Lista compacta dos 3 controladores com status real do armazenamento MongoDB */}
              <div className="space-y-2.5">
                {nosControladores.map((no) => {
                  // Verifica se o identificador de armazenamento reporta conexão ativa ao MongoDB
                  const bancoConectado = Boolean(no.armazenamentoId?.includes('[CONECTADO]'));
                  // Extrai a porta do MongoDB (ex: 27017, 27018, 27019) quando presente na URI
                  const matchPortaBanco = no.armazenamentoId?.match(/:(\d{4,5})(?:\/|\?|$)/);
                  // Formata o sufixo compacto da porta para exibição no card da réplica
                  const portaBancoLabel = matchPortaBanco ? `:${matchPortaBanco[1]}` : '';

                  return (
                    <div
                      key={no.porta}
                      className={`p-3 rounded-lg border transition space-y-1.5 ${
                        !no.online
                          ? 'border-zinc-800/60 bg-zinc-900/20 opacity-50'
                          : no.statusConsenso === 'DESCARTADO_BIZANTINO'
                          ? 'border-amber-500/40 bg-amber-950/15'
                          : 'border-zinc-800/80 bg-zinc-900/60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${no.online ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                          <span className="text-xs font-semibold text-zinc-200">{no.nome}</span>
                          <span className="font-mono text-[10px] text-zinc-500">:{no.porta}</span>
                        </div>

                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                          !no.online
                            ? 'bg-rose-500/10 text-rose-400'
                            : no.statusConsenso === 'DESCARTADO_BIZANTINO'
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'bg-emerald-500/15 text-emerald-400'
                        }`}>
                          {!no.online ? 'Offline' : no.statusConsenso === 'DESCARTADO_BIZANTINO' ? 'Bizantino' : 'Voto Válido'}
                        </span>
                      </div>

                      {/* Linha secundária exibindo se o nó grava no MongoDB ou opera em Fallback RAM */}
                      <div className="flex items-center gap-1.5 text-[10px] font-mono pl-4">
                        {!no.online ? (
                          /* Indica que o banco não pôde ser verificado porque o controlador está offline */
                          <span className="text-zinc-500">Banco: inacessível (nó offline)</span>
                        ) : bancoConectado ? (
                          /* Exibe indicador verde confirmando persistência real no MongoDB */
                          <>
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                            <span className="text-emerald-400/90 truncate">
                              MongoDB {portaBancoLabel} conectado
                            </span>
                          </>
                        ) : (
                          /* Exibe indicador âmbar alertando que o nó está em Fallback RAM */
                          <>
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                            <span className="text-amber-300/90 truncate">
                              Fallback RAM (MongoDB {portaBancoLabel} offline)
                            </span>
                          </>
                        )}
                      </div>

                      {/* Botão de Controle Individual para Matar ou Reviver o Controlador (Crash / Recovery) */}
                      <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60 mt-1">
                        {/* Indicador do estado operacional do processo */}
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {no.online ? 'Em Execução' : 'Parada Simulada (Crash)'}
                        </span>
                        {/* Botão de alternância de status operacional */}
                        <button
                          type="button"
                          onClick={() => alternarStatusNo(no)}
                          className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-all flex items-center gap-1.5 ${
                            no.online
                              ? 'border border-rose-900/60 bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 hover:text-white hover:border-rose-700 shadow-sm'
                              : 'border border-emerald-900/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 hover:text-white hover:border-emerald-700 shadow-sm animate-pulse'
                          }`}
                        >
                          {no.online ? (
                            <>
                              {/* Ícone de caveira indicando parada */}
                              <span>💀</span>
                              {/* Rótulo para derrubar o nó */}
                              <span>Derrubar Nó</span>
                            </>
                          ) : (
                            <>
                              {/* Ícone de raio indicando recuperação */}
                              <span>⚡</span>
                              {/* Rótulo para reviver o nó */}
                              <span>Reviver Nó</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bloco 5: Console de Auditoria e Failover com Altura e Largura RIGIDAMENTE FIXAS (Nunca expande com logs) */}
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4 h-[300px] min-h-[300px] max-h-[300px] w-full min-w-0 max-w-full overflow-hidden flex flex-col space-y-2.5 shrink-0">
              {/* Cabeçalho do Console de Auditoria com Dimensão Fixa */}
              <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2 shrink-0">
                {/* Título do Console */}
                <div>
                  <h2 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                    Console de Auditoria &amp; Failover
                  </h2>
                </div>

                {/* Botões de Filtro incluindo visualização direta do Histórico MongoDB */}
                <div className="flex gap-1 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setFiltroLog('TODOS')}
                    className={`px-2 py-0.5 rounded transition ${filtroLog === 'TODOS' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltroLog('FAILOVER')}
                    className={`px-2 py-0.5 rounded transition ${filtroLog === 'FAILOVER' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    Failover
                  </button>
                  {/* Aba que exibe os registros persistidos no histórico do controlador/MongoDB */}
                  <button
                    type="button"
                    onClick={() => setFiltroLog('HISTORICO_DB')}
                    className={`px-2 py-0.5 rounded transition ${filtroLog === 'HISTORICO_DB' ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-500/30' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    MongoDB
                  </button>
                </div>
              </div>

              {/* Área Interna de Rolagem com Altura Imutável (215px cravados) que Força a Rolagem sem Expandir o Card */}
              <div className="h-[215px] min-h-[215px] max-h-[215px] w-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden rounded-lg border border-zinc-800/80 bg-zinc-950/70 p-3 font-mono text-[11px] space-y-2 shrink-0">
                {filtroLog === 'HISTORICO_DB' ? (
                  /* Renderiza o histórico real retornado no campo estadoConsenso.historico */
                  (estadoConsenso?.historico?.length ?? 0) === 0 ? (
                    <p className="text-zinc-600 text-xs">Nenhum registro no histórico persistido ainda...</p>
                  ) : (
                    estadoConsenso?.historico?.map((reg, idx) => (
                      <div key={`${reg.horario}-${idx}`} className="border-b border-zinc-900 pb-1.5 last:border-0 min-w-0">
                        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                          {/* Exibe o horário formatado do evento salvo */}
                          <span>{formatarHorarioRegistro(reg.horario)}</span>
                          {/* Badge identificando a categoria do registro persistido */}
                          <span className="px-1 rounded text-emerald-300 bg-emerald-950/50">
                            {reg.tipo}
                          </span>
                        </div>
                        {/* Descrição completa do evento registrado no histórico */}
                        <p className="text-zinc-300 mt-0.5 break-words">{reg.descricao}</p>
                      </div>
                    ))
                  )
                ) : logsApresentados.length === 0 ? (
                  <p className="text-zinc-600 text-xs">Aguardando eventos do sistema...</p>
                ) : (
                  logsApresentados.map((log) => (
                    <div key={log.id} className="border-b border-zinc-900 pb-1.5 last:border-0 min-w-0">
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                        <span>{log.horario}</span>
                        <span className={`px-1 rounded ${
                          log.tipo === 'FAILOVER' ? 'text-amber-400 bg-amber-950/40' : 'text-zinc-400 bg-zinc-900'
                        }`}>
                          {log.tipo}
                        </span>
                      </div>
                      <p className="text-zinc-300 mt-0.5 break-words break-all">{log.mensagem}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
