// Importa os tipos NextRequest e NextResponse para manipulação de rotas da API no Next.js
import { NextRequest, NextResponse } from 'next/server';
// Importa as funções gRPC para ativar o modo calma
import { rpcAtivarModoCalmaManual, ativarModoCalmaComFailover } from '@/lib/grpcClient';

// Configura esta rota para nunca ser armazenada em cache
export const dynamic = 'force-dynamic';

// Trata requisição POST para ativar a Regulação Sensorial via gRPC
export async function POST(req: NextRequest) {
  // Bloco try/catch para captura de erros
  try {
    // Extrai os parâmetros da query string se houver (ex: ?porta=3001)
    const { searchParams } = new URL(req.url);
    // Identifica se uma porta específica foi indicada
    const portaParam = searchParams.get('porta');
    // Faz a leitura do corpo da requisição JSON se fornecido
    const body = await req.json().catch(() => ({}));
    // Extrai o identificador da origem do cliente
    const origem = body?.origem || 'Dashboard Cliente';

    // Se uma porta específica foi informada
    if (portaParam) {
      // Converte para número inteiro
      const porta = parseInt(portaParam, 10);
      // Invoca a RPC diretamente na porta do controlador indicado
      const resultado = await rpcAtivarModoCalmaManual(porta, origem, 1500);
      // Retorna a resposta com status 200
      return NextResponse.json(resultado, { status: 200 });
    }

    // Caso contrário, executa com tolerância a falhas (Failover automático: 3001 -> 3002 -> 3003)
    const resultado = await ativarModoCalmaComFailover(origem);
    // Retorna a resposta gRPC serializada em JSON com status 200
    return NextResponse.json(resultado, { status: 200 });
  } catch (error: any) {
    // Retorna status 500 caso a invocação gRPC falhe em todos os nós
    return NextResponse.json(
      {
        sucesso: false,
        erro: 'Falha ao acionar Modo Calma via gRPC.',
        detalhes: error?.message || 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
