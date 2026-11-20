// Importa o tipo NextResponse para manipular respostas HTTP no Next.js
import { NextResponse } from 'next/server';

// Handler GET para capturar requisições de navegadores buscando /favicon.ico e redirecionar ao ícone SVG oficial
export async function GET(request: Request) {
  // Resolve a URL absoluta para o recurso /icon.svg da aplicação
  const iconeUrl = new URL('/icon.svg', request.url);
  // Retorna redirecionamento permanente/temporário para o arquivo SVG existente
  return NextResponse.redirect(iconeUrl);
}
