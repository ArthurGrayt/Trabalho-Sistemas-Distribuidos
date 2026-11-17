// Importa a biblioteca 'mqtt' para permitir que o Smart Speaker atue como Subscriber de comandos
import mqtt from 'mqtt';

// Define o endereço de rede do broker MQTT local
const BROKER_URL = 'mqtt://localhost:1883';
// Define o tópico de comando que este atuador deve assinar para receber instruções dos controladores
const TOPIC_COMANDO = 'clinica/sala1/comando/som';

// Conecta o atuador de áudio ao broker MQTT com um identificador único
const client = mqtt.connect(BROKER_URL, {
  // Identifica o dispositivo como atuador de Smart Speaker nos logs do broker
  clientId: `atuador_speaker_${Math.random().toString(16).slice(2, 6)}`,
});

// Evento disparado assim que o Smart Speaker se conecta com sucesso ao broker
client.on('connect', () => {
  // Loga a confirmação de conexão do hardware simulado
  console.log(`[ATUADOR SMART SPEAKER] Conectado ao broker em ${BROKER_URL}`);
  // Assina o tópico de comando de som para receber ordens do middleware
  client.subscribe(TOPIC_COMANDO, { qos: 0 }, (err) => {
    // Verifica se houve falha ao registrar a assinatura no broker
    if (err) {
      // Exibe erro caso a assinatura não possa ser realizada
      console.error(`[ATUADOR SMART SPEAKER] Erro ao assinar tópico:`, err);
    } else {
      // Confirma que o atuador está ouvindo ativamente as ordens no tópico especificado
      console.log(`[ATUADOR SMART SPEAKER] Aguardando comandos em: ${TOPIC_COMANDO}`);
    }
  });
});

// Evento disparado toda vez que uma mensagem é publicada no tópico assinado por este atuador
client.on('message', (topic, message) => {
  // Bloco try/catch para garantir que um JSON malformado não derrube o processo do atuador
  try {
    // Converte o Buffer recebido para string e faz o parse para um objeto JavaScript
    const comando = JSON.parse(message.toString());
    // Imprime uma linha divisória para destacar a atuação física no console
    console.log(`-----------------------------------------------------`);
    // Exibe qual ação o Smart Speaker está executando (ex: tocar "ruído branco") e qual controlador enviou
    console.log(`🔊 [SMART SPEAKER] Ação Recebida no tópico [${topic}]`);
    // Mostra os detalhes do som configurado, volume ou modo terapêutico
    console.log(`   -> Reproduzindo áudio: "${comando.som || comando.acao}" | Origem: ${comando.origem || 'Middleware'}`);
    // Fecha o bloco visual no terminal
    console.log(`-----------------------------------------------------`);
  } catch {
    // Caso a mensagem não seja um JSON válido, exibe o texto puro recebido
    console.log(`🔊 [SMART SPEAKER] Comando bruto recebido: ${message.toString()}`);
  }
});

// Trata erros de conexão do cliente MQTT
client.on('error', (err) => {
  // Loga a mensagem de erro no terminal
  console.error(`[ATUADOR SMART SPEAKER] Erro MQTT:`, err.message);
});

