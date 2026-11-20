// Importa a biblioteca 'mqtt' para conectar o sistema de iluminação inteligente ao broker
import mqtt from 'mqtt';

// Define a URL do broker MQTT local (127.0.0.1 para evitar atrasos IPv6 no Windows)
const BROKER_URL = 'mqtt://127.0.0.1:1883';
// Define o tópico exclusivo para recebimento de comandos de iluminação da Sala 1
const TOPIC_COMANDO = 'clinica/sala1/comando/luz';

// Inicializa o cliente MQTT representando o módulo de lâmpadas RGB da Diverterapia
const client = mqtt.connect(BROKER_URL, {
  // Atribui um ID único para o atuador de iluminação
  clientId: `atuador_iluminacao_${Math.random().toString(16).slice(2, 6)}`,
});

// Executa quando a conexão com o broker MQTT é estabelecida
client.on('connect', () => {
  // Informa no console que o módulo de iluminação está online
  console.log(`[ATUADOR ILUMINAÇÃO] Conectado ao broker em ${BROKER_URL}`);
  // Realiza a inscrição (subscribe) no tópico de comandos de luz
  client.subscribe(TOPIC_COMANDO, { qos: 0 }, (err) => {
    // Verifica se ocorreu algum erro na inscrição do tópico
    if (err) {
      // Reporta o erro no console
      console.error(`[ATUADOR ILUMINAÇÃO] Erro ao assinar tópico:`, err);
    } else {
      // Confirma que o atuador está pronto para alterar a cor/intensidade da sala
      console.log(`[ATUADOR ILUMINAÇÃO] Aguardando comandos em: ${TOPIC_COMANDO}`);
    }
  });
});

// Escuta a chegada de novas mensagens publicadas pelos controladores no tópico de iluminação
client.on('message', (topic, message) => {
  // Usa try/catch para decodificar o payload JSON com segurança
  try {
    // Transforma o payload binário em objeto JSON
    const comando = JSON.parse(message.toString());
    // Imprime separador visual no terminal
    console.log(`-----------------------------------------------------`);
    // Notifica a mudança de estado da iluminação da sala pediátrica
    console.log(`💡 [ILUMINAÇÃO RGB] Ação Recebida no tópico [${topic}]`);
    // Detalha a cor/estado aplicado (ex: "azul/calma") e quem disparou o comando
    console.log(`   -> Ajustando luz para: "${comando.cor || comando.estado}" | Origem: ${comando.origem || 'Middleware'}`);
    // Fecha o separador visual
    console.log(`-----------------------------------------------------`);
  } catch {
    // Exibe a mensagem como texto simples caso não esteja em formato JSON
    console.log(`💡 [ILUMINAÇÃO RGB] Comando bruto recebido: ${message.toString()}`);
  }
});

// Captura falhas de comunicação com o broker MQTT
client.on('error', (err) => {
  // Exibe o erro no console
  console.error(`[ATUADOR ILUMINAÇÃO] Erro MQTT:`, err.message);
});

