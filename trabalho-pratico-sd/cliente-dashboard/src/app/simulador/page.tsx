// Diretiva obrigatória do Next.js App Router para habilitar hooks de estado e APIs do navegador (Web Audio API)
'use client';

// Importa os hooks do React para estado, referências mutáveis, efeitos e callbacks
import React, { useState, useEffect, useRef, useCallback } from 'react';
// Importa o componente Link do Next.js para navegação rápida de volta ao Dashboard principal
import Link from 'next/link';
// Importa os ícones solicitados da biblioteca lucide-react mantendo o layout homologado
import { User, Activity, Volume2, Mic, MicOff, CheckCircle2, AlertCircle, Loader2, ArrowLeft, LogOut, Clock, Sparkles } from 'lucide-react';

// Interface que define a estrutura da notificação (Toast) sutil exibida no topo da tela mobile
interface ToastInfo {
  // Identificador único do toast
  id: number;
  // Texto descritivo curto da operação publicada no MQTT
  mensagem: string;
  // Tipo visual do toast ('sucesso' ou 'erro')
  tipo: 'sucesso' | 'erro';
}

// Interface para os itens da fila de espera recebidos do middleware
interface ItemFila {
  // Nome do paciente na fila
  nome: string;
  // Estilo musical selecionado
  musica: string;
  // Cor favorita para iluminação
  cor: string;
  // Horário em que entrou na fila
  horario?: string;
}

// Componente principal da página do Simulador Mobile (/simulador) com gerenciamento de fila de espera
export default function SimuladorMobilePage() {
  // Estado para o campo "Nome da Criança" no Card 1
  const [nomeCrianca, setNomeCrianca] = useState<string>('');
  // Estado para o Dropdown "Cor Favorita para Iluminação" (Opções: Azul, Verde, Amarelo, Vermelho, Roxo, Branco)
  const [corFavorita, setCorFavorita] = useState<string>('Azul');
  // Estado para o Dropdown de estilos musicais (Opções: Rock, Pop, Eletrônica, Gospel, Acústica)
  const [estiloMusical, setEstiloMusical] = useState<string>('Rock');
  // Estado que sinaliza se as preferências foram salvas pelo aluno
  const [preferenciasSalvas, setPreferenciasSalvas] = useState<boolean>(false);
  // Estado que armazena a lista atual da fila de espera sincronizada com o cluster
  const [filaEspera, setFilaEspera] = useState<ItemFila[]>([]);
  // Estado que indica se a Sala 1 está ocupada no momento
  const [salaOcupada, setSalaOcupada] = useState<boolean>(false);
  // Estado com o nome do paciente que está atualmente dentro da Sala 1
  const [ocupanteAtual, setOcupanteAtual] = useState<string>('Nenhum paciente');
  // Estado de carregamento exclusivo dos botões de presença/fila no Card 1
  const [enviandoPresenca, setEnviandoPresenca] = useState<boolean>(false);

  // Estado para o valor atual de batimentos cardíacos (BPM) no Card 2 (60 a 160)
  const [bpm, setBpm] = useState<number>(80);
  // Estado de carregamento sutil ao enviar BPM no Card 2
  const [enviandoBpm, setEnviandoBpm] = useState<boolean>(false);

  // Estado booleano que indica se o microfone real (Web Audio API) está ativo no Card 3
  const [microfoneAtivo, setMicrofoneAtivo] = useState<boolean>(false);
  // Estado para alternar a aba/switch de "Modo Manual" (Fallback) no Card 3
  const [modoManualRuido, setModoManualRuido] = useState<boolean>(false);
  // Estado que armazena o valor em decibéis (dB) exibido em tempo real no Card 3 (40 a 120)
  const [ruidoDb, setRuidoDb] = useState<number>(62);
  // Estado de carregamento ao publicar ruído no broker MQTT
  const [enviandoRuido, setEnviandoRuido] = useState<boolean>(false);

  // Estado que armazena o Toast sutil exibido ao enviar dados para a API
  const [toast, setToast] = useState<ToastInfo | null>(null);

  // Referência para armazenar a instância do AudioContext da Web Audio API
  const audioContextRef = useRef<AudioContext | null>(null);
  // Referência para armazenar o MediaStream do microfone do smartphone/navegador
  const mediaStreamRef = useRef<MediaStream | null>(null);
  // Referência para armazenar o identificador do loop de animação (requestAnimationFrame) da leitura de áudio
  const rafIdRef = useRef<number | null>(null);
  // Referência para armazenar o temporizador de publicação de média a cada 2 segundos
  const intervaloPublicacaoRef = useRef<NodeJS.Timeout | null>(null);
  // Referência para acumular as amostras de decibéis coletadas durante a janela de 2 segundos
  const amostrasDbRef = useRef<number[]>([]);
  // Referência para debounce de envio em tempo real ao arrastar o slider de BPM
  const debounceBpmRef = useRef<NodeJS.Timeout | null>(null);
  // Referência para debounce de envio em tempo real ao arrastar o slider de Ruído Manual
  const debounceRuidoRef = useRef<NodeJS.Timeout | null>(null);

  // Calcula se o paciente deste smartphone está atualmente em atendimento na Sala 1
  const estouNaSala = Boolean(
    salaOcupada &&
    nomeCrianca.trim() &&
    ocupanteAtual.trim().toLowerCase() === nomeCrianca.trim().toLowerCase()
  );

  // Calcula a posição deste aluno na fila de espera (-1 se não estiver na fila)
  const minhaPosicaoNaFila = filaEspera.findIndex(
    (item) => nomeCrianca.trim() && item.nome.trim().toLowerCase() === nomeCrianca.trim().toLowerCase()
  );

  // Função auxiliar que exibe um toast discreto e o remove automaticamente após 2,5 segundos
  const exibirToast = useCallback((mensagem: string, tipo: 'sucesso' | 'erro' = 'sucesso') => {
    // Define o novo toast com timestamp atual como ID
    setToast({ id: Date.now(), mensagem, tipo });
  }, []);

  // Efeito que limpa o toast automaticamente após 2500ms
  useEffect(() => {
    // Se não houver toast ativo, não agenda temporizador
    if (!toast) return;
    // Cria o timer para ocultar o toast
    const timer = setTimeout(() => {
      setToast(null);
    }, 2500);
    // Limpa o timer caso um novo toast substitua o anterior
    return () => clearTimeout(timer);
  }, [toast]);

  // Função periódica de polling que consulta o status do middleware e a fila de espera em tempo real
  const sincronizarStatusEFila = useCallback(async () => {
    try {
      // Faz requisição para a rota interna /api/status do Next.js (compatível com qualquer celular na rede)
      const res = await fetch('/api/status', { cache: 'no-store' });
      // Se a resposta for válida
      if (res.ok) {
        // Extrai o envelope JSON do objeto distribuído
        const dados = await res.json();
        // Extrai o estado atual da Sala 1
        const est = dados?.estado;
        if (est) {
          // Atualiza se a sala está ocupada
          setSalaOcupada(Boolean(est.presenca));
          // Atualiza o nome de quem está na sala
          setOcupanteAtual(est.tagId || 'Nenhum paciente');
          // Atualiza a lista da fila de espera
          if (Array.isArray(est.filaEspera)) {
            setFilaEspera(est.filaEspera);
          }
        }
      }
    } catch {
      // Falha transitória de rede ignorada no ciclo de polling
    }
  }, []);

  // Hook que executa o polling a cada 1000ms para garantir transição automática de fila entre múltiplos celulares
  useEffect(() => {
    // Sincronização inicial imediata
    sincronizarStatusEFila();
    // Temporizador recorrente de 1 segundo
    const timer = setInterval(() => {
      sincronizarStatusEFila();
    }, 1000);
    // Limpeza ao desmontar
    return () => clearInterval(timer);
  }, [sincronizarStatusEFila]);

  // Função genérica que envia o POST para a rota Ponte HTTP -> MQTT (/api/mqtt/publish)
  const publicarNoMqtt = useCallback(
    async (topic: string, message: Record<string, unknown>, labelToast?: string) => {
      // Faz a requisição HTTP POST para a API Route do Next.js
      const res = await fetch('/api/mqtt/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, message }),
      });

      // Verifica se o status HTTP retornado indica falha
      if (!res.ok) {
        // Extrai a mensagem de erro do JSON retornado pela API
        const erroDados = await res.json().catch(() => ({}));
        throw new Error(erroDados.erro || `Falha HTTP ${res.status}`);
      }

      // Exibe o toast sutil confirmando a publicação caso solicitado
      if (labelToast) {
        exibirToast(labelToast, 'sucesso');
      }
    },
    [exibirToast]
  );

  // Handler do Botão "Salvar Preferências": publica no tópico clinica/recepcao/checkin e entra na fila de espera
  const handleSalvarPreferencias = async () => {
    // Remove espaços extras do nome da criança
    const nomeLimpo = nomeCrianca.trim();

    // Validação obrigatória: exige que o nome seja informado
    if (!nomeLimpo) {
      exibirToast('Por favor, informe o nome da criança.', 'erro');
      return;
    }

    // Ativa estado de carregamento do botão
    setEnviandoPresenca(true);
    try {
      // Publica no tópico clinica/recepcao/checkin com payload exigido: { acao: "entrar_fila", nome, musica, cor }
      await publicarNoMqtt(
        'clinica/recepcao/checkin',
        {
          acao: 'entrar_fila',
          nome: nomeLimpo,
          musica: estiloMusical,
          cor: corFavorita,
        },
        'Preferências salvas'
      );
      // Marca as preferências como salvas para alternar o botão para Simular Entrada ou Aguarde sua vez
      setPreferenciasSalvas(true);
      // Força sincronização imediata com o middleware
      await sincronizarStatusEFila();
    } catch (err: unknown) {
      // Exibe toast em caso de falha de conexão
      const msg = err instanceof Error ? err.message : 'Erro ao salvar preferências';
      exibirToast(msg, 'erro');
    } finally {
      // Desativa estado de carregamento
      setEnviandoPresenca(false);
    }
  };

  // Handler do Botão "Simular Entrada" (acionado quando a sala está livre após salvar preferências)
  const handleSimularEntrada = async (e: React.FormEvent) => {
    // Previne envio padrão do formulário
    e.preventDefault();
    // Se as preferências ainda não foram salvas, salva primeiro
    if (!preferenciasSalvas) {
      await handleSalvarPreferencias();
      return;
    }

    // Se a sala estiver livre, realiza o check-in imediato
    if (!salaOcupada || estouNaSala) {
      setEnviandoPresenca(true);
      try {
        await publicarNoMqtt(
          'clinica/recepcao/checkin',
          {
            acao: 'entrar_fila',
            nome: nomeCrianca.trim(),
            musica: estiloMusical,
            cor: corFavorita,
          },
          `Entrada confirmada: ${nomeCrianca.trim()}`
        );
        await sincronizarStatusEFila();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Erro ao simular entrada';
        exibirToast(msg, 'erro');
      } finally {
        setEnviandoPresenca(false);
      }
    } else {
      // Caso outro celular tenha ocupado a sala antes, avisa para aguardar
      exibirToast('Sala ocupada por outro paciente. Você está na fila de espera.', 'erro');
    }
  };

  // Handler para finalizar o atendimento e liberar a sala (o próximo da fila entra automaticamente no middleware)
  const handleFinalizarAtendimento = async () => {
    // Ativa estado de carregamento
    setEnviandoPresenca(true);
    try {
      // Publica em clinica/sala1/porta { presenca: false } para disparar a admissão automática do próximo na fila
      await publicarNoMqtt(
        'clinica/sala1/porta',
        {
          presenca: false,
          nome: 'Nenhum paciente',
          musica: 'Aguardando paciente',
        },
        'Atendimento finalizado. Sala liberada!'
      );
      // Reseta estado local de preferências salvas
      setPreferenciasSalvas(false);
      // Atualiza o status imediatamente
      await sincronizarStatusEFila();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao liberar sala';
      exibirToast(msg, 'erro');
    } finally {
      setEnviandoPresenca(false);
    }
  };

  // Handler de mudança em tempo real do slider de BPM (envia via debounce enquanto arrasta)
  const handleChangeBpm = (novoBpm: number) => {
    setBpm(novoBpm);
    if (debounceBpmRef.current) {
      clearTimeout(debounceBpmRef.current);
    }
    debounceBpmRef.current = setTimeout(() => {
      publicarNoMqtt('clinica/sala1/bpm', { bpm: novoBpm }).catch(() => {});
    }, 120);
  };

  // Handler do Card 2: Publica o valor final de BPM ao soltar o slider
  const handlePublicarBpm = async () => {
    if (debounceBpmRef.current) {
      clearTimeout(debounceBpmRef.current);
      debounceBpmRef.current = null;
    }
    if (enviandoBpm) return;
    setEnviandoBpm(true);
    try {
      await publicarNoMqtt('clinica/sala1/bpm', { bpm }, `BPM publicado: ${bpm} BPM`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao publicar BPM';
      exibirToast(msg, 'erro');
    } finally {
      setEnviandoBpm(false);
    }
  };

  // Handler de mudança em tempo real do slider de Ruído Manual
  const handleChangeRuidoManual = (novoDb: number) => {
    setRuidoDb(novoDb);
    if (debounceRuidoRef.current) {
      clearTimeout(debounceRuidoRef.current);
    }
    debounceRuidoRef.current = setTimeout(() => {
      publicarNoMqtt('clinica/sala1/ruido', { db: novoDb }).catch(() => {});
    }, 120);
  };

  // Handler do Card 3: Publica o valor de dB ao soltar o slider manual
  const handlePublicarRuidoManual = async () => {
    if (debounceRuidoRef.current) {
      clearTimeout(debounceRuidoRef.current);
      debounceRuidoRef.current = null;
    }
    if (enviandoRuido) return;
    setEnviandoRuido(true);
    try {
      await publicarNoMqtt('clinica/sala1/ruido', { db: ruidoDb }, `Ruído publicado: ${ruidoDb} dB`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao publicar ruído';
      exibirToast(msg, 'erro');
    } finally {
      setEnviandoRuido(false);
    }
  };

  // Função que encerra a captura do microfone e limpa recursos
  const pararMicrofone = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (intervaloPublicacaoRef.current) {
      clearInterval(intervaloPublicacaoRef.current);
      intervaloPublicacaoRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    amostrasDbRef.current = [];
    setMicrofoneAtivo(false);
  }, []);

  // Função que inicializa a captura de áudio real via Web Audio API e publica a cada 2s
  const iniciarMicrofone = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setModoManualRuido(true);
      exibirToast('Microfone indisponível neste navegador. Modo Manual ativado.', 'erro');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      amostrasDbRef.current = [];
      setMicrofoneAtivo(true);
      setModoManualRuido(false);
      exibirToast('Microfone ativado — medindo dB em tempo real', 'sucesso');

      const atualizarMedicao = () => {
        analyser.getByteTimeDomainData(dataArray);
        let somaQuadrados = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalizado = (dataArray[i] - 128) / 128;
          somaQuadrados += normalizado * normalizado;
        }
        const rms = Math.sqrt(somaQuadrados / dataArray.length);
        const proporcao = Math.min(1, Math.pow(rms * 2.6, 0.65));
        const dbCalculado = Math.round(40 + proporcao * (120 - 40));
        const dbClamped = Math.max(40, Math.min(120, dbCalculado));

        setRuidoDb(dbClamped);
        amostrasDbRef.current.push(dbClamped);

        rafIdRef.current = requestAnimationFrame(atualizarMedicao);
      };

      rafIdRef.current = requestAnimationFrame(atualizarMedicao);

      intervaloPublicacaoRef.current = setInterval(async () => {
        const amostras = amostrasDbRef.current;
        if (amostras.length === 0) return;

        const soma = amostras.reduce((acc, val) => acc + val, 0);
        const mediaDb = Math.round(soma / amostras.length);
        amostrasDbRef.current = [];

        setEnviandoRuido(true);
        try {
          await publicarNoMqtt('clinica/sala1/ruido', { db: mediaDb }, `Média 2s publicada: ${mediaDb} dB`);
        } catch {
          // Ignora silenciosamente
        } finally {
          setEnviandoRuido(false);
        }
      }, 2000);
    } catch {
      setModoManualRuido(true);
      exibirToast('Permissão de microfone negada. Use o Modo Manual abaixo.', 'erro');
    }
  };

  // Limpa recursos ao desmontar
  useEffect(() => {
    return () => {
      pararMicrofone();
      if (debounceBpmRef.current) clearTimeout(debounceBpmRef.current);
      if (debounceRuidoRef.current) clearTimeout(debounceRuidoRef.current);
    };
  }, [pararMicrofone]);

  // Renderização da interface Mobile-First com o Design System homologado
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans pb-12 selection:bg-zinc-800">
      {/* Toast Sutil Flutuante no Topo da Tela Mobile */}
      <div className="fixed top-4 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
        {toast && (
          <div
            className={`pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border backdrop-blur-md shadow-xl text-xs font-medium transition-all duration-200 ${
              toast.tipo === 'sucesso'
                ? 'bg-zinc-900/90 border-white/10 text-zinc-100'
                : 'bg-zinc-900/95 border-red-500/30 text-red-400'
            }`}
          >
            {toast.tipo === 'sucesso' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            )}
            <span>{toast.mensagem}</span>
          </div>
        )}
      </div>

      {/* Container Mobile-First Centralizado */}
      <div className="mx-auto max-w-md px-4 pt-6 flex flex-col gap-4">
        {/* Cabeçalho Minimalista do Simulador Mobile */}
        <header className="flex items-center justify-between px-1 pb-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Diverterapia • Fila Distribuída
              </span>
            </div>
            <h1 className="text-lg font-bold tracking-tight text-zinc-100 mt-0.5">
              Simulador Mobile de Sensores
            </h1>
          </div>

          {/* Link sutil para voltar ao Dashboard principal */}
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/5 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] active:scale-95 transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Painel</span>
          </Link>
        </header>

        {/* CARD 1: Presença e Gerenciamento de Fila de Espera */}
        <section className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 flex flex-col gap-5">
          {/* Cabeçalho do Card 1 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <User className="w-4 h-4 text-zinc-400" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Entrada do Paciente
              </h2>
            </div>
            <span className="text-[10px] font-mono text-zinc-600">clinica/recepcao/checkin</span>
          </div>

          {/* FEEDBACK VISUAL DE FILA (STATE) */}
          <div className="p-3.5 rounded-2xl bg-black/20 border border-white/5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-500 font-medium">Situação da Sala:</span>
              {/* Badge Dinâmico de Status */}
              <span
                className={`text-xs font-semibold flex items-center gap-1.5 ${
                  estouNaSala
                    ? 'text-emerald-400'
                    : minhaPosicaoNaFila >= 0
                    ? 'text-amber-400'
                    : salaOcupada
                    ? 'text-zinc-400'
                    : 'text-emerald-400'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    estouNaSala
                      ? 'bg-emerald-400 animate-pulse'
                      : minhaPosicaoNaFila >= 0
                      ? 'bg-amber-400 animate-pulse'
                      : salaOcupada
                      ? 'bg-zinc-500'
                      : 'bg-emerald-400'
                  }`}
                />
                {estouNaSala
                  ? 'Você está na Sala 1'
                  : minhaPosicaoNaFila >= 0
                  ? `Aguarde sua vez (${minhaPosicaoNaFila + 1}º na fila)`
                  : salaOcupada
                  ? `Ocupada (${ocupanteAtual})`
                  : 'Sala 1 Livre'}
              </span>
            </div>

            {/* Mensagem Explicativa de Transição Automática de Fila */}
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              {estouNaSala ? (
                <span className="text-emerald-400/90">
                  Seus dados e atuadores estão sincronizados com a sala em tempo real.
                </span>
              ) : minhaPosicaoNaFila >= 0 ? (
                <span className="text-amber-300/90">
                  Assim que {ocupanteAtual} sair, você entrará automaticamente na Sala 1.
                </span>
              ) : salaOcupada ? (
                <span>
                  Sala ocupada no momento. Salve suas preferências para aguardar sua vez na fila.
                </span>
              ) : (
                <span>Sala livre para atendimento imediato. Salve suas preferências para entrar.</span>
              )}
            </p>
          </div>

          {/* FORMULÁRIO COM NOVOS CAMPOS DROPDOWN */}
          <form onSubmit={handleSimularEntrada} className="flex flex-col gap-4">
            {/* Campo 1: Nome da Criança */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-zinc-400 pl-1">
                Nome da Criança
              </label>
              <input
                type="text"
                value={nomeCrianca}
                onChange={(e) => {
                  setNomeCrianca(e.target.value);
                  setPreferenciasSalvas(false);
                }}
                placeholder="Ex: Lucas (ou Sofia)"
                className="w-full h-12 px-4 rounded-2xl bg-black/20 border border-white/5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-white/20 transition-all"
              />
            </div>

            {/* Campo 2: Dropdown de Estilos Musicais (Rock, Pop, Eletrônica, Gospel, Acústica) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-zinc-400 pl-1">
                Estilo Musical / Trilha Favorita
              </label>
              <select
                value={estiloMusical}
                onChange={(e) => {
                  setEstiloMusical(e.target.value);
                  setPreferenciasSalvas(false);
                }}
                className="w-full h-12 px-4 rounded-2xl bg-black/20 border border-white/5 text-sm text-zinc-100 focus:outline-none focus:border-white/20 transition-all cursor-pointer"
              >
                <option value="Rock" className="bg-zinc-900 text-zinc-100">Rock</option>
                <option value="Pop" className="bg-zinc-900 text-zinc-100">Pop</option>
                <option value="Eletrônica" className="bg-zinc-900 text-zinc-100">Eletrônica</option>
                <option value="Gospel" className="bg-zinc-900 text-zinc-100">Gospel</option>
                <option value="Acústica" className="bg-zinc-900 text-zinc-100">Acústica</option>
              </select>
            </div>

            {/* Campo 3: Dropdown de Cor Favorita (Azul, Verde, Amarelo, Vermelho, Roxo, Branco) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-zinc-400 pl-1">
                Cor Favorita para Iluminação
              </label>
              <select
                value={corFavorita}
                onChange={(e) => {
                  setCorFavorita(e.target.value);
                  setPreferenciasSalvas(false);
                }}
                className="w-full h-12 px-4 rounded-2xl bg-black/20 border border-white/5 text-sm text-zinc-100 focus:outline-none focus:border-white/20 transition-all cursor-pointer"
              >
                <option value="Azul" className="bg-zinc-900 text-zinc-100">Azul</option>
                <option value="Verde" className="bg-zinc-900 text-zinc-100">Verde</option>
                <option value="Amarelo" className="bg-zinc-900 text-zinc-100">Amarelo</option>
                <option value="Vermelho" className="bg-zinc-900 text-zinc-100">Vermelho</option>
                <option value="Roxo" className="bg-zinc-900 text-zinc-100">Roxo</option>
                <option value="Branco" className="bg-zinc-900 text-zinc-100">Branco</option>
              </select>
            </div>

            {/* BOTÕES DE AÇÃO: Salvar Preferências -> Simular Entrada / Aguarde sua vez */}
            <div className="flex flex-col gap-2.5 mt-1">
              {!preferenciasSalvas ? (
                /* Botão Inicial: Salvar Preferências */
                <button
                  type="button"
                  onClick={handleSalvarPreferencias}
                  disabled={enviandoPresenca}
                  className="min-h-[48px] w-full rounded-2xl bg-white/10 hover:bg-white/15 active:scale-95 transition-all text-sm font-semibold text-zinc-100 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {enviandoPresenca ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-zinc-300" />
                      <span>Salvar Preferências</span>
                    </>
                  )}
                </button>
              ) : estouNaSala ? (
                /* Botão quando este aluno está em atendimento na Sala 1 */
                <button
                  type="button"
                  onClick={handleFinalizarAtendimento}
                  disabled={enviandoPresenca}
                  className="min-h-[48px] w-full rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 active:scale-95 transition-all text-sm font-semibold text-zinc-100 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {enviandoPresenca ? (
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
                  ) : (
                    <LogOut className="w-4 h-4 text-red-400" />
                  )}
                  <span>Finalizar Atendimento (Liberar Sala)</span>
                </button>
              ) : !salaOcupada ? (
                /* Botão após salvar preferências quando a sala está livre: Simular entrada */
                <button
                  type="submit"
                  disabled={enviandoPresenca}
                  className="min-h-[48px] w-full rounded-2xl bg-emerald-500/20 hover:bg-emerald-500/25 border border-emerald-500/30 active:scale-95 transition-all text-sm font-semibold text-emerald-300 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {enviandoPresenca ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-300" />
                      <span>Entrando na sala...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Simular Entrada</span>
                    </>
                  )}
                </button>
              ) : (
                /* Botão após salvar preferências quando a sala está ocupada: Aguarde sua vez */
                <button
                  type="button"
                  disabled={true}
                  className="min-h-[48px] w-full rounded-2xl bg-white/[0.04] border border-white/5 text-sm font-semibold text-zinc-400 flex items-center justify-center gap-2 cursor-not-allowed"
                >
                  <Clock className="w-4 h-4 text-amber-400 animate-spin" />
                  <span>
                    {minhaPosicaoNaFila >= 0
                      ? `Aguarde sua vez (${minhaPosicaoNaFila + 1}º da fila)`
                      : 'Aguarde sua vez (Na fila)'}
                  </span>
                </button>
              )}

              {/* Opção para alterar preferências salvas se ainda não estiver na sala */}
              {preferenciasSalvas && !estouNaSala && (
                <button
                  type="button"
                  onClick={() => setPreferenciasSalvas(false)}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300 transition py-1 text-center"
                >
                  Editar preferências salvas
                </button>
              )}
            </div>
          </form>
        </section>

        {/* CARD 2: Pulseira Smart (Frequência Cardíaca) - Mantido Intacto */}
        <section className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 flex flex-col gap-5">
          {/* Cabeçalho do Card 2 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Activity className="w-4 h-4 text-zinc-400" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Batimentos (BPM)
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {enviandoBpm && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />}
              <span className="text-[10px] font-mono text-zinc-600">clinica/sala1/bpm</span>
            </div>
          </div>

          {/* Valor Numérico Gigante Centralizado */}
          <div className="py-3 flex flex-col items-center justify-center">
            <div className="flex items-baseline gap-2">
              <span
                className={`text-5xl font-bold tracking-tight tabular-nums transition-colors ${
                  bpm > 120 ? 'text-red-500 drop-shadow-[0_0_12px_rgba(239,68,68,0.25)]' : 'text-zinc-100'
                }`}
              >
                {bpm}
              </span>
              <span className="text-sm font-semibold text-zinc-500 uppercase">BPM</span>
            </div>
            <span className="text-[11px] text-zinc-500 mt-1">
              {bpm > 120 ? 'Acima do limiar de estresse (> 120 BPM)' : 'Faixa cardíaca pediátrica normal'}
            </span>
          </div>

          {/* Slider Estilizado em Tons de Cinza e Branco (60 a 160 BPM) */}
          <div className="flex flex-col gap-2">
            <input
              type="range"
              min={60}
              max={160}
              value={bpm}
              onChange={(e) => handleChangeBpm(Number(e.target.value))}
              onMouseUp={handlePublicarBpm}
              onTouchEnd={handlePublicarBpm}
              className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-100"
            />
            <div className="flex justify-between text-[11px] font-mono text-zinc-500">
              <span>60 BPM</span>
              <span>Limiar: 120</span>
              <span>160 BPM</span>
            </div>
          </div>
        </section>

        {/* CARD 3: Ruído Acústico (Microfone Real + Fallback Manual) - Mantido Intacto */}
        <section className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 flex flex-col gap-5">
          {/* Cabeçalho do Card 3 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Volume2 className="w-4 h-4 text-zinc-400" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Ruído Ambiente
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {enviandoRuido && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />}
              <span className="text-[10px] font-mono text-zinc-600">clinica/sala1/ruido</span>
            </div>
          </div>

          {/* Exibição do Valor Gigante de Decibéis (muda apenas a cor do texto se > 85 dB) */}
          <div className="py-3 flex flex-col items-center justify-center">
            <div className="flex items-baseline gap-2">
              <span
                className={`text-5xl font-bold tracking-tight tabular-nums transition-colors duration-150 ${
                  ruidoDb > 85
                    ? 'text-red-500 [text-shadow:0_0_16px_rgba(239,68,68,0.35)]'
                    : 'text-zinc-100'
                }`}
              >
                {ruidoDb}
              </span>
              <span className="text-sm font-semibold text-zinc-500">dB</span>
            </div>
            <span className="text-[11px] text-zinc-500 mt-1">
              {microfoneAtivo
                ? 'Capturando microfone (média enviada a cada 2s)'
                : ruidoDb > 85
                ? 'Ruído crítico detectado (> 85 dB)'
                : 'Nível acústico confortável (≤ 85 dB)'}
            </span>
          </div>

          {/* Botão Principal: Habilitar / Desabilitar Microfone via Web Audio API */}
          <button
            type="button"
            onClick={microfoneAtivo ? pararMicrofone : iniciarMicrofone}
            className="min-h-[48px] w-full rounded-2xl bg-white/10 hover:bg-white/15 active:scale-95 transition-all text-sm font-semibold text-zinc-100 flex items-center justify-center gap-2.5"
          >
            {microfoneAtivo ? (
              <>
                <MicOff className="w-4 h-4 text-red-400" />
                <span>Desativar Microfone em Tempo Real</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 text-zinc-300" />
                <span>Habilitar Microfone</span>
              </>
            )}
          </button>

          {/* Divisor e Switch para Modo Manual (Fallback) */}
          <div className="pt-3 border-t border-white/5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">
                Modo Manual (Fallback Slider)
              </span>
              <button
                type="button"
                onClick={() => {
                  if (microfoneAtivo) pararMicrofone();
                  setModoManualRuido((prev) => !prev);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all active:scale-95 ${
                  modoManualRuido
                    ? 'bg-white/15 border-white/15 text-zinc-100'
                    : 'bg-black/20 border-white/5 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {modoManualRuido ? 'Ativo' : 'Alternar para Manual'}
              </button>
            </div>

            {/* Slider de Fallback Manual (40 a 120 dB) exibido quando Modo Manual está selecionado */}
            {modoManualRuido && (
              <div className="flex flex-col gap-2 pt-1">
                <input
                  type="range"
                  min={40}
                  max={120}
                  value={ruidoDb}
                  onChange={(e) => handleChangeRuidoManual(Number(e.target.value))}
                  onMouseUp={handlePublicarRuidoManual}
                  onTouchEnd={handlePublicarRuidoManual}
                  className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-100"
                />
                <div className="flex justify-between text-[11px] font-mono text-zinc-500">
                  <span>40 dB</span>
                  <span>Crítico: 85 dB</span>
                  <span>120 dB</span>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
