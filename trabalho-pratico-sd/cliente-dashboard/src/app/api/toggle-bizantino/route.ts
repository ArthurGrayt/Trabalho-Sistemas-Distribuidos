// Importa os tipos NextRequest e NextResponse para manipulação de rotas da API no Next.js
import { NextRequest, NextResponse } from 'next/server';
// Importa a função RPC que alterna a injeção bizantina no Controlador 3
import { rpcToggleBizantino } from '@/lib/grpcClient';

// Configura esta rota para execução dinâmica sem cache estático
export const dynamic = 'force-dynamic';

// Trata requisições POST para alternar a simulação de falha bizantina via gRPC
export async function POST(_req: NextRequest) {
  // Bloco try/catch para tratamento de erros
  try {
    // Executa a chamada RPC ToggleBizantino no Controlador 3 (porta 3003)
    const resultado = await rpcToggleBizantino(1500);
    // Retorna a resposta com status 200
    return NextResponse.json(resultado, { status: 200 });
  } catch (error: any) {
    // Retorna status 500 caso o Controlador 3 esteja inacessível via gRPC
    return NextResponse.json(
      {
        sucesso: false,
        erro: 'Falha ao alternar Falha Bizantina via gRPC no Controlador 3.',
        detalhes: error?.message || 'Falha de comunicação',
      },
      { status: 500 }
    );
  }
}
