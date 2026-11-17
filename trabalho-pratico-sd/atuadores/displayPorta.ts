// Importa a biblioteca 'mqtt' para conectar o painel eletrônico da porta da sala ao broker
import mqtt from 'mqtt';

// Define o endereço de conexão com o broker MQTT local
const BROKER_URL = 'mqtt://localhost:1883';
// Define o tópico de comando para atualizar as mensagens do display da porta da Sala 1
const TOPIC_COMANDO = 'clinica/sala1/comando/display';

// Conecta ao broker MQTT identificando este processo como o atuador do Display de Porta
const client = mqtt.connect(BROKER_URL, {
  // Gera um identificador único de sessão MQTT para o display
  clientId: `atuador_display_${Math.random().toString(16).slice(2, 6)}`,
});

// Callback acionado quando a conexão com o broker é concluída
client.on('connect', () => {
  // Registra no terminal que o display da porta está conectado
  console.log(`[ATUADOR DISPLAY PORTA] Conectado ao broker em ${BROKER_URL}`);
  // Assina o tópico de comandos visuais do display
  client.subscribe(TOPIC_COMANDO, { qos: 0 }, (err) => {
    // Trata eventual erro na assinatura do tópico
    if (err) {
      // Imprime o erro no console
      console.error(`[ATUADOR DISPLAY PORTA] Erro ao assinar tópico:`, err);
    } else {
      // Confirma que o display está aguardando atualizações de status da sala
      console.log(`[ATUADOR DISPLAY PORTA] Aguardando comandos em: ${TOPIC_COMANDO}`);
    }
  });
});

// Processa todas as mensagens entregues pelo broker no tópico do display
client.on('message', (topic, message) => {
  // Protege o parse do JSON contra mensagens inválidas
  try {
    // Converte a mensagem recebida em um objeto estruturado
    const comando = JSON.parse(message.toString());
    // Imprime linha divisória para leitura clara no terminal
    console.log(`-----------------------------------------------------`);
    // Indica que o painel eletrônico da porta recebeu uma nova instrução
    console.log(`🖥️  [DISPLAY PORTA] Ação Recebida no tópico [${topic}]`);
    // Exibe o texto que está sendo mostrado na porta da sala e a origem do comando
    console.log(`   -> Exibindo mensagem: "${comando.mensagem || comando.texto}" | Origem: ${comando.origem || 'Middleware'}`);
    // Finaliza o bloco visual no console
    console.log(`-----------------------------------------------------`);
  } catch {
    // Caso não seja JSON, imprime a string diretamente
    console.log(`🖥️  [DISPLAY PORTA] Comando bruto recebido: ${message.toString()}`);
  }
});

// Monitora erros de conexão com o broker
client.on('error', (err) => {
  // Loga o erro caso ocorra perda de comunicação
  console.error(`[ATUADOR DISPLAY PORTA] Erro MQTT:`, err.message);
});

