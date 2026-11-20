// Importa os tipos NextRequest e NextResponse para manipulação de rotas da API no Next.js
import { NextRequest, NextResponse } from 'next/server';
// Importa as funções auxiliares gRPC para consulta individual ou diagnóstico completo do cluster
import { rpcObterStatus, obterDiagnosticoCluster } from '@/lib/grpcClient';

// Configura esta rota para nunca ser armazenada em cache estático
export const dynamic = 'force-dynamic';

// Rota GET /api/status para fornecer telemetria consolidada e saúde real do cluster via gRPC
export async function GET(req: NextRequest) {
  // Bloco try/catch para capturar falhas inesperadas na camada de gateway gRPC
  try {
    // Extrai os parâmetros de query string da URL
    const { searchParams } = new URL(req.url);
    // Verifica se um nó específico foi solicitado (?porta=3001)
    const portaParam = searchParams.get('porta');

    // Caso uma porta específica tenha sido pedida, consulta diretamente aquele nó via gRPC
    if (portaParam) {
      // Converte o parâmetro textual da porta para número inteiro
      const porta = parseInt(portaParam, 10);
      // Valida se a porta informada pertence a um dos 3 controladores do cluster
      if (![3001, 3002, 3003].includes(porta)) {
        // Retorna erro 400 caso a porta solicitada seja inválida
        return NextResponse.json({ erro: 'Porta inválida. Use 3001, 3002 ou 3003.' }, { status: 400 });
      }
      // Consulta diretamente o controlador na porta solicitada via RPC ObterStatus
      const dados = await rpcObterStatus(porta, 1500);
      // Retorna a resposta individual do nó com status HTTP 200
      return NextResponse.json(dados, { status: 200 });
    }

    // Consulta os 3 nós gRPC em paralelo para apurar a saúde real de cada controlador
    const diagnosticoCompleto = await obterDiagnosticoCluster(800);

    // Monta o resumo enxuto do cluster sem duplicar o payload de estado três vezes
    const cluster = diagnosticoCompleto.map((no) => ({
      // Identificador nominal do nó
      id: no.id,
      // Nome amigável do controlador
      nome: no.nome,
      // Porta TCP/gRPC do controlador
      porta: no.porta,
      // Prefixo de rota proxy no Next.js
      url: no.url,
      // Indicador booleano se o nó respondeu à RPC
      online: no.online,
      // Status de integridade reportado pelo controlador
      integridade: no.integridade,
      // Identificador da instância MongoDB associada ao nó
      armazenamentoId: no.armazenamentoId,
    }));

    // Seleciona o primeiro nó online e não-bizantino por prioridade (3001 -> 3002 -> 3003)
    const noPrincipal = diagnosticoCompleto.find(
      (no) => no.online && no.integridade !== 'FALHA_BIZANTINA' && no.dados
    );

    // Se nenhuma réplica saudável estiver disponível, retorna 200 com flag clusterIndisponivel e diagnóstico offline para evitar poluição de erros 503 no console do navegador durante o polling de 500ms
    if (!noPrincipal || !noPrincipal.dados) {
      // Retorna payload JSON informativo de degradação/indisponibilidade do cluster
      return NextResponse.json(
        {
          // Sinaliza explicitamente ao frontend que nenhum controlador íntegro respondeu
          clusterIndisponivel: true,
          // Mensagem principal sobre a indisponibilidade dos nós gRPC
          erro: 'Todos os controladores íntegros do middleware estão inacessíveis.',
          // Detalhamento técnico da falha de comunicação gRPC
          detalhes: 'Nenhuma réplica saudável respondeu à consulta gRPC.',
          // Mantém a lista dos 3 nós com seus respectivos status (OFFLINE / FALHA_BIZANTINA)
          cluster,
        },
        // Usa HTTP 200 para que o navegador não dispare "Failed to load resource: 503" a cada 500ms quando os nós são desligados em testes de tolerância a falhas
        { status: 200 }
      );
    }

    // Retorna o estado validado pelo nó principal selecionado junto com o diagnóstico real do cluster
    return NextResponse.json(
      {
        ...noPrincipal.dados,
        obtidoViaFailoverNaPorta: noPrincipal.porta,
        cluster,
      },
      { status: 200 }
    );
  } catch (error: any) {
    // Em caso de falha inesperada na camada de gateway gRPC, retorna 503
    return NextResponse.json(
      {
        erro: 'Todos os controladores gRPC do middleware estão inacessíveis.',
        detalhes: error?.message || 'Falha de conexão gRPC',
      },
      { status: 503 }
    );
  }
}
