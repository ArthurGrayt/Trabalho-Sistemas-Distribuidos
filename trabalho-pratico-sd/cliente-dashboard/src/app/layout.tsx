// Importa o tipo Metadata do Next.js para definir título e descrição da página no head HTML
import type { Metadata } from 'next';
// Importa a folha de estilos global contendo as diretivas do Tailwind CSS
import './globals.css';

// Define os metadados estáticos da aplicação exibidos na aba do navegador
export const metadata: Metadata = {
  // Título acadêmico e descritivo do sistema
  title: 'Diverterapia IoT | Dashboard de Sistemas Distribuídos',
  // Descrição dos conceitos de Sistemas Distribuídos implementados no projeto
  description:
    'Monitoramento IoT Pediátrico com MQTT Publish/Subscribe, Replicação, Tolerância a Falhas (Failover) e Consenso Bizantino (Quorum 2x1).',
};

// Componente de Layout Raiz que envolve todas as páginas da aplicação Next.js
export default function RootLayout({
  // Recebe os elementos filhos (páginas) como propriedade
  children,
}: {
  // Tipagem estrita do React para nós filhos
  children: React.ReactNode;
}) {
  // Retorna a estrutura HTML principal em Português do Brasil com suppressHydrationWarning para ignorar atributos injetados por extensões do navegador (ex: data-bry-content-script-soc)
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      {/* Aplica suavização de fontes (antialiased), altura mínima de tela cheia e suprime avisos de hidratação causados por extensões no body */}
      <body suppressHydrationWarning className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {/* Renderiza o conteúdo da página ativa */}
        {children}
      </body>
    </html>
  );
}

