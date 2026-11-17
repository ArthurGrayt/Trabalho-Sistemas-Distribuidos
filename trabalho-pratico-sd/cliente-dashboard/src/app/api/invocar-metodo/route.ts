// Importa os tipos NextRequest e NextResponse para manipulação de rotas da API no Next.js
import { NextRequest, NextResponse } from 'next/server';
// Importa as funções de invocação remota gRPC
import { rpcInvocarMetodo, invocarMetodoComFailover } from '@/lib/grpcClient';

// Configura esta rota para execução dinâmica sem cache estático
export const dynamic = 'force-dynamic';

// Trata requisições POST para invocação de métodos remotos nos controladores gRPC
export async function POST(req: NextRequest) {
  // Bloco try/catch para tratamento de erros
  try {
    // Extrai parâmetros de consulta da URL (ex: ?porta=3001)
    const { searchParams } = new URL(req.url);
    // Identifica se uma porta específica foi passada
    const portaParam = searchParams.get('porta');
    // Faz o parse do corpo da requisição JSON
    const body = await req.json().catch(() => ({}));
    // Extrai o nome do método remoto a ser executado
    const metodo = body?.metodo || 'ativarModoCalmaManual';
    // Extrai o cliente de origem
    const origem = body?.origem || 'Dashboard Cliente';
    // Extrai os parâmetros opcionais dos atuadores
    const parametros = body?.parametros || {};

    // Se uma porta específica foi definida na requisição
    if (portaParam) {
      // Converte para número inteiro
      const porta = parseInt(portaParam, 10);
      // Invoca a RPC diretamente na réplica gRPC correspondente
      const resultado = await rpcInvocarMetodo(porta, metodo, origem, parametros, 1500);
      // Retorna o resultado com status 200
      return NextResponse.json(resultado, { status: 200 });
    }

    // Caso contrário, executa a chamada com Failover automático (3001 -> 3002 -> 3003)
    const resultado = await invocarMetodoComFailover(metodo, origem, parametros);
    // Retorna a resposta gRPC serializada em JSON com status 200
    return NextResponse.json(resultado, { status: 200 });
  } catch (error: any) {
    // Retorna status 500 caso todos os nós gRPC estejam inacessíveis
    return NextResponse.json(
      {
        sucesso: false,
        erro: 'Falha ao executar método remoto via gRPC.',
        detalhes: error?.message || 'Erro de comunicação',
      },
      { status: 500 }
    );
  }
}
