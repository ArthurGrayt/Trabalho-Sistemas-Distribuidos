// Importa os tipos NextRequest e NextResponse para manipulação de rotas da API no Next.js
import { NextRequest, NextResponse } from 'next/server';
// Importa as funções auxiliares de comunicação gRPC com failover
import { rpcObterStatus, obterStatusComFailover } from '@/lib/grpcClient';

// Configura esta rota para nunca ser armazenada em cache estático
export const dynamic = 'force-dynamic';

// Rota GET /api/status para fornecer telemetria e fila de espera aos clientes web e mobile
export async function GET(req: NextRequest) {
  // Bloco try/catch para captura de exceções
  try {
    // Extrai os parâmetros de busca da URL da requisição
    const { searchParams } = new URL(req.url);
    // Verifica se uma porta específica foi solicitada (ex: /api/status?porta=3001)
    const portaParam = searchParams.get('porta');

    // Se uma porta específica foi informada
    if (portaParam) {
      // Converte a porta para número inteiro
      const porta = parseInt(portaParam, 10);
      // Valida se a porta pertence ao cluster (3001, 3002 ou 3003)
      if (![3001, 3002, 3003].includes(porta)) {
        // Retorna erro 400 se a porta for inválida
        return NextResponse.json({ erro: 'Porta inválida. Use 3001, 3002 ou 3003.' }, { status: 400 });
      }
      // Consulta diretamente o nó gRPC na porta indicada
      const dados = await rpcObterStatus(porta, 1500);
      // Retorna os dados com status 200
      return NextResponse.json(dados, { status: 200 });
    }

    // Caso nenhuma porta seja especificada, executa failover automático (3001 -> 3002 -> 3003)
    const dadosFailover = await obterStatusComFailover();
    // Retorna os dados com status 200
    return NextResponse.json(dadosFailover, { status: 200 });
  } catch (error: any) {
    // Em caso de falha de todos os nós gRPC, retorna 503 (Service Unavailable)
    return NextResponse.json(
      {
        erro: 'Todos os controladores gRPC do middleware estão inacessíveis.',
        detalhes: error?.message || 'Falha de conexão gRPC',
      },
      { status: 503 }
    );
  }
}
