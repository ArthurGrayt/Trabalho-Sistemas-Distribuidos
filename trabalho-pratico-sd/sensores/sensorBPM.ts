// Importa a biblioteca 'mqtt' para conectar o nó de monitoramento cardíaco ao broker
import mqtt from 'mqtt';

// Define o endereço do broker MQTT local rodando na porta 1883
const BROKER_URL = 'mqtt://localhost:1883';
// Define o tópico MQTT onde o Simulador Mobile (/simulador) publica os batimentos cardíacos (BPM)
const TOPIC_BPM = 'clinica/sala1/bpm';

// Inicializa a conexão do cliente MQTT atribuindo uma identificação exclusiva
const client = mqtt.connect(BROKER_URL, {
  // Gera um clientId único para o sensor de BPM no broker Aedes
  clientId: `sensor_bpm_${Math.random().toString(16).slice(2, 6)}`,
});

// Registra o callback executado assim que o handshake MQTT com o broker é concluído
client.on('connect', () => {
  // Confirma no console que o sensor cardíaco iniciou sua operação
  console.log(`[SENSOR BPM] Conectado ao broker em ${BROKER_URL}`);
  // Informa que os valores de BPM agora são controlados exclusivamente pelo Simulador Mobile (/simulador)
  console.log(`[SENSOR BPM] Modo Tempo Real ativo (sem dados aleatórios). Escutando /simulador no tópico: ${TOPIC_BPM}`);

  // Assina o tópico de BPM para logar no terminal cada atualização feita no Simulador Mobile
  client.subscribe(TOPIC_BPM, { qos: 0 }, (err) => {
    // Verifica se ocorreu erro na assinatura do tópico
    if (err) {
      // Exibe o erro no console
      console.error(`[SENSOR BPM] Erro ao assinar tópico ${TOPIC_BPM}:`, err.message);
    }
  });
});

// Exibe no terminal os pacotes de BPM enviados em tempo real pelo Simulador Mobile
client.on('message', (topic, message) => {
  // Verifica se o tópico corresponde ao sensor de BPM da Sala 1
  if (topic === TOPIC_BPM) {
    // Mostra o payload real enviado pelo Simulador Mobile
    console.log(`[SENSOR BPM] Leitura do Simulador Mobile: ${message.toString()}`);
  }
});

// Captura erros de transporte ou recusa de conexão caso o broker ainda não tenha sido iniciado
client.on('error', (err) => {
  // Imprime o erro no console de forma amigável
  console.error(`[SENSOR BPM] Erro de conexão MQTT:`, err.message);
});
