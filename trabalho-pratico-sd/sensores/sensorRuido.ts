// Importa a biblioteca 'mqtt' para conectar o nó de monitoramento acústico ao broker
import mqtt from 'mqtt';

// Define a URL de conexão apontando para o broker MQTT local na porta 1883
const BROKER_URL = 'mqtt://localhost:1883';
// Define o tópico onde o Simulador Mobile (/simulador) publica o ruído em tempo real
const TOPIC_RUIDO = 'clinica/sala1/ruido';

// Conecta ao broker MQTT passando um clientId exclusivo para este sensor
const client = mqtt.connect(BROKER_URL, {
  // Define um ID único combinando o nome do sensor e um sufixo aleatório
  clientId: `sensor_ruido_${Math.random().toString(16).slice(2, 6)}`,
});

// Escuta o evento 'connect' que confirma a conexão com o broker MQTT
client.on('connect', () => {
  // Exibe no terminal que o sensor de ruído está conectado ao broker
  console.log(`[SENSOR RUÍDO] Conectado ao broker em ${BROKER_URL}`);
  // Informa que os valores de decibéis agora vêm exclusivamente em tempo real do Simulador Mobile (/simulador)
  console.log(`[SENSOR RUÍDO] Modo Tempo Real ativo (sem dados aleatórios). Escutando /simulador no tópico: ${TOPIC_RUIDO}`);

  // Assina o tópico de ruído para refletir no terminal os valores enviados pelo Simulador Mobile
  client.subscribe(TOPIC_RUIDO, { qos: 0 }, (err) => {
    // Verifica se houve falha ao assinar o tópico
    if (err) {
      // Registra o erro no console
      console.error(`[SENSOR RUÍDO] Erro ao assinar tópico ${TOPIC_RUIDO}:`, err.message);
    }
  });
});

// Processa e exibe no console cada leitura de dB enviada pelo Simulador Mobile (/simulador)
client.on('message', (topic, message) => {
  // Confirma que o pacote veio do tópico de ruído da Sala 1
  if (topic === TOPIC_RUIDO) {
    // Imprime no terminal o valor real recebido do Simulador Mobile
    console.log(`[SENSOR RUÍDO] Leitura do Simulador Mobile: ${message.toString()}`);
  }
});

// Escuta eventos de erro de conexão para evitar que o processo caia silenciosamente
client.on('error', (err) => {
  // Exibe a mensagem de erro no console caso o broker esteja inacessível
  console.error(`[SENSOR RUÍDO] Erro de conexão MQTT:`, err.message);
});
