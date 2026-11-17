// Importa a biblioteca 'mqtt' para conectar o nó de monitoramento de presença ao broker
import mqtt from 'mqtt';

// Define a URL onde o broker MQTT Aedes está escutando conexões locais
const BROKER_URL = 'mqtt://localhost:1883';
// Define o tópico MQTT utilizado pelo Simulador Mobile (/simulador) para enviar entrada e saída de pacientes
const TOPIC_PORTA = 'clinica/sala1/porta';

// Conecta ao broker MQTT identificando este processo como o monitor do sensor de presença
const client = mqtt.connect(BROKER_URL, {
  // Gera um identificador único para a sessão MQTT deste sensor
  clientId: `sensor_presenca_${Math.random().toString(16).slice(2, 6)}`,
});

// Executa quando a conexão com o broker MQTT for estabelecida com sucesso
client.on('connect', () => {
  // Informa no terminal que o sensor está conectado ao broker MQTT
  console.log(`[SENSOR PRESENÇA] Conectado ao broker em ${BROKER_URL}`);
  // Informa que os pacientes agora são enviados exclusivamente em tempo real pelo Simulador Mobile (/simulador)
  console.log(`[SENSOR PRESENÇA] Modo Tempo Real ativo (sem pacientes mockados). Aguardando eventos de /simulador em: ${TOPIC_PORTA}`);

  // Assina o tópico da porta para exibir no terminal todas as entradas de pacientes enviadas pelo Simulador Mobile
  client.subscribe(TOPIC_PORTA, { qos: 0 }, (err) => {
    // Verifica se houve erro ao assinar o tópico
    if (err) {
      // Exibe o erro no console caso a assinatura falhe
      console.error(`[SENSOR PRESENÇA] Erro ao assinar tópico ${TOPIC_PORTA}:`, err.message);
    }
  });
});

// Escuta as mensagens publicadas pelo Simulador Mobile (/simulador) para registrar no terminal
client.on('message', (topic, message) => {
  // Verifica se a mensagem recebida pertence ao tópico da porta da Sala 1
  if (topic === TOPIC_PORTA) {
    // Imprime no terminal o payload real enviado pelo Simulador Mobile
    console.log(`[SENSOR PRESENÇA] Evento em tempo real recebido do Simulador: ${message.toString()}`);
  }
});

// Monitora erros de comunicação com o broker MQTT
client.on('error', (err) => {
  // Exibe a descrição do erro no console
  console.error(`[SENSOR PRESENÇA] Erro de conexão MQTT:`, err.message);
});
