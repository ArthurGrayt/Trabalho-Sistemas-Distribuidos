// Importa a biblioteca 'aedes', responsável por instanciar o broker MQTT em memória no Node.js
import aedes from 'aedes';
// Importa o módulo nativo 'net' do Node.js para criar o servidor TCP que transportará o protocolo MQTT
import { createServer } from 'net';

// Inicializa uma nova instância do broker MQTT Aedes para gerenciar tópicos, clientes e mensagens
const broker = new aedes();
// Cria um servidor TCP utilizando o método 'handle' do Aedes para processar conexões MQTT de entrada
const server = createServer(broker.handle);
// Define a porta padrão 1883 do protocolo MQTT para escuta de conexões na rede local
const PORT = 1883;

// Inicia o servidor TCP na porta especificada e executa o callback assim que estiver pronto
server.listen(PORT, () => {
  // Exibe no console um cabeçalho visual confirmando que o Broker MQTT está online e operante
  console.log(`=====================================================`);
  // Informa a porta exata em que o Broker da Clínica Pediátrica está aguardando conexões
  console.log(`[BROKER MQTT] Diverterapia rodando na porta ${PORT}`);
  // Fecha o cabeçalho visual no terminal para facilitar a leitura dos logs
  console.log(`=====================================================`);
});

// Registra um listener para o evento 'client', disparado sempre que um novo sensor, atuador ou controlador se conecta
broker.on('client', (client) => {
  // Imprime no terminal o identificador único (ID) do cliente MQTT recém-conectado
  console.log(`[CONEXÃO] Cliente conectado ao Broker: ${client ? client.id : 'Desconhecido'}`);
});

// Registra um listener para o evento 'clientDisconnect', disparado quando um dispositivo encerra ou perde a conexão
broker.on('clientDisconnect', (client) => {
  // Imprime no terminal qual cliente desconectou para rastreamento de disponibilidade dos nós
  console.log(`[DESCONEXÃO] Cliente desconectado: ${client ? client.id : 'Desconhecido'}`);
});

// Registra um listener para o evento 'subscribe', disparado quando um cliente assina um ou mais tópicos
broker.on('subscribe', (subscriptions, client) => {
  // Mapeia a lista de assinaturas para extrair apenas os nomes dos tópicos em uma string separada por vírgula
  const topicos = subscriptions.map((s) => s.topic).join(', ');
  // Registra no console qual cliente assinou quais tópicos do barramento de eventos
  console.log(`[SUBSCRIBE] Cliente ${client ? client.id : 'Desconhecido'} assinou: ${topicos}`);
});

// Registra um listener para o evento 'publish', disparado toda vez que uma mensagem circula pelo broker
broker.on('publish', (packet, client) => {
  // Verifica se a mensagem foi enviada por um cliente externo (ignora mensagens internas de controle do próprio broker que começam com $SYS)
  if (client) {
    // Converte o buffer binário do payload da mensagem para uma string legível em UTF-8
    const mensagem = packet.payload.toString();
    // Exibe no console os detalhes do evento: quem publicou, em qual tópico e o conteúdo do pacote JSON
    console.log(`[PUBLISH] De: ${client.id} | Tópico: ${packet.topic} | Payload: ${mensagem}`);
  }
});

