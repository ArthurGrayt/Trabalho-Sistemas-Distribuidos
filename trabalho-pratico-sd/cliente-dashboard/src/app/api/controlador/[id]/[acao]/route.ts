// Importa os tipos NextRequest e NextResponse para manipulação de rotas dinâmicas da API no Next.js
import { NextRequest, NextResponse } from 'next/server';
// Importa as funções RPC para comunicação direta com os nós gRPC
import {
  rpcObterStatus,
  rpcAtivarModoCalmaManual,
  rpcInvocarMetodo,
  rpcToggleBizantino,
  rpcAlternarStatusOperacional,
} from '@/lib/grpcClient';

// Configura esta rota para execução dinâmica sem cache
export const dynamic = 'force-dynamic';

// Mapa de identificadores de nós para suas respectivas portas gRPC
const PORTAS_MAP: Record<string, number> = {
  '1': 3001,
  '2': 3002,
  '3': 3003,
  '3001': 3001,
  '3002': 3002,
  '3003': 3003,
};

// Handler GET para consultas de status gRPC por nó (ex: /api/controlador/1/status)
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; acao: string } }
) {
  // Bloco try/catch para tratamento de erros
  try {
    // Obtém o ID do controlador a partir dos parâmetros de rota
    const { id, acao } = params;
    // Resolve a porta gRPC correspondente
    const porta = PORTAS_MAP[id];

    // Valida se a porta foi identificada
    if (!porta) {
      // Retorna 404 caso o controlador não exista
      return NextResponse.json({ erro: `Controlador '${id}' não encontrado.` }, { status: 404 });
    }

    // Se a ação solicitada for 'status'
    if (acao === 'status') {
      // Executa a chamada RPC ObterStatus no nó gRPC especificado
      const dados = await rpcObterStatus(porta, 1500);
      // Retorna os dados com status 200
      return NextResponse.json(dados, { status: 200 });
    }

    // Retorna erro para ações GET não suportadas
    return NextResponse.json({ erro: `Ação GET '${acao}' não suportada.` }, { status: 400 });
  } catch (error: any) {
    // Retorna status 503 indicando que o nó gRPC está offline
    return NextResponse.json(
      {
        erro: `Falha ao comunicar com o Controlador na porta ${PORTAS_MAP[params.id] || params.id} via gRPC.`,
        detalhes: error?.message || 'Conexão recusada',
      },
      { status: 503 }
    );
  }
}

// Handler POST para mutações e procedimentos remotos gRPC por nó (ex: /api/controlador/1/modo-calma)
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; acao: string } }
) {
  // Bloco try/catch para captura de exceções
  try {
    // Extrai os parâmetros id e acao
    const { id, acao } = params;
    // Resolve a porta correspondente
    const porta = PORTAS_MAP[id];

    // Valida a existência do nó
    if (!porta) {
      return NextResponse.json({ erro: `Controlador '${id}' não encontrado.` }, { status: 404 });
    }

    // Faz o parse do corpo JSON da requisição se presente
    const body = await req.json().catch(() => ({}));

    // Se a ação for 'modo-calma'
    if (acao === 'modo-calma') {
      // Extrai a identificação da origem do cliente
      const origem = body?.origem || 'Dashboard Cliente';
      // Invoca a RPC AtivarModoCalmaManual no nó indicado
      const resultado = await rpcAtivarModoCalmaManual(porta, origem, 1500);
      // Retorna a resposta com status 200
      return NextResponse.json(resultado, { status: 200 });
    }

    // Se a ação for 'invocar-metodo'
    if (acao === 'invocar-metodo') {
      // Extrai os dados do método remoto
      const metodo = body?.metodo || 'ativarModoCalmaManual';
      const origem = body?.origem || 'Dashboard Cliente';
      const parametros = body?.parametros || {};
      // Invoca a RPC InvocarMetodo
      const resultado = await rpcInvocarMetodo(porta, metodo, origem, parametros, 1500);
      // Retorna a resposta
      return NextResponse.json(resultado, { status: 200 });
    }

    // Se a ação for 'toggle-bizantino'
    if (acao === 'toggle-bizantino') {
      // Alterna a falha bizantina via RPC no nó 3
      const resultado = await rpcToggleBizantino(1500);
      // Retorna a resposta
      return NextResponse.json(resultado, { status: 200 });
    }

    // Se a ação for 'toggle-crash' ou 'alternar-status' para simular parada/recuperação do nó
    if (acao === 'toggle-crash' || acao === 'alternar-status') {
      // Invoca a RPC AlternarStatusOperacional no controlador na porta correspondente
      const resultado = await rpcAlternarStatusOperacional(porta, 2500);
      // Retorna a resposta com status 200
      return NextResponse.json(resultado, { status: 200 });
    }

    // Retorna erro para ações POST não mapeadas
    return NextResponse.json({ erro: `Ação POST '${acao}' não reconhecida.` }, { status: 400 });
  } catch (error: any) {
    // Retorna status 503 caso o nó gRPC esteja inacessível
    return NextResponse.json(
      {
        sucesso: false,
        erro: `Falha ao executar '${params.acao}' no nó ${PORTAS_MAP[params.id] || params.id} via gRPC.`,
        detalhes: error?.message || 'Falha de comunicação',
      },
      { status: 503 }
    );
  }
}
