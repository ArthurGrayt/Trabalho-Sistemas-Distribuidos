// Exporta a configuração do PostCSS necessária para processar o Tailwind CSS e o Autoprefixer no Next.js
module.exports = {
  // Registra os plugins de transformação CSS
  plugins: {
    // Processa as diretivas @tailwind no arquivo globals.css
    tailwindcss: {},
    // Adiciona prefixos de fornecedores automaticamente para compatibilidade entre navegadores
    autoprefixer: {},
  },
};

