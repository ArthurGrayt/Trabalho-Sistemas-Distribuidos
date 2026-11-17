/** @type {import('tailwindcss').Config} */
// Exporta a configuração do Tailwind CSS mapeando os diretórios onde as classes utilitárias são utilizadas
module.exports = {
  // Lista os caminhos dos arquivos TSX/TS que devem ser processados pelo compilador JIT do Tailwind
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // Permite estender o tema padrão do Tailwind caso necessário
  theme: {
    extend: {},
  },
  // Lista de plugins adicionais do Tailwind (vazia pois usamos apenas recursos nativos)
  plugins: [],
};

