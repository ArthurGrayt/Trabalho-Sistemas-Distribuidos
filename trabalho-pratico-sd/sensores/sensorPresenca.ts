// Importa a biblioteca 'mqtt' para publicar eventos de presença física ao broker Eclipse Mosquitto
import mqtt from 'mqtt';
// Importa o módulo nativo 'readline' para permitir publicação manual interativa via CLI
import * as readline from 'readline';

// Define a URL onde o broker MQTT Eclipse Mosquitto está escutando conexões locais
const BROKER_URL = 'mqtt://127.0.0.1:1883';
// Define o tópico MQTT de presença/porta da Sala 1
const TOPIC_PORTA = 'clinica/sala1/porta';
// Verifica se o sensor foi iniciado com a flag --auto para alternância automática de presença
const MODO_AUTO = process.argv.includes('--auto');

// Conecta ao broker MQTT identificando este processo como publicador de presença/RFID
const client = mqtt.connect(BROKER_URL, {
  // Gera identificador exclusivo de sessão MQTT
  clientId: `sensor_presenca_${Math.random().toString(16).slice(2, 6)}`,
});

// Mantém controle local do estado alternado quando executado em modo --auto
let estadoPresencaAuto = false;

// Função auxiliar que publica evento de entrada ou saída de paciente no tópico da porta
function publicarPresenca(presenca: boolean, nome?: string): void {
  // Monta o payload estruturado compatível com as regras clínicas do middleware
  const payload = JSON.stringify({
    // Booleano indicando presença na sala
    presenca,
    // Nome do paciente caso entrando, ou marcador padrão caso saindo
    nome: presenca ? nome || 'Paciente RFID' : 'Nenhum paciente',
    // Música favorita padrão ao entrar via sensor físico
    musica: presenca ? 'Acústica' : 'Aguardando paciente',
    // Cor favorita padrão ao entrar via sensor físico
    cor: presenca ? 'Verde' : 'Branco',
    // Carimbo temporal único do evento para sincronização de Quorum
    timestamp: new Date().toISOString(),
  });
  // Publica a mensagem no tópico MQTT com QoS 0 (papel estrito de Publisher)
  client.publish(TOPIC_PORTA, payload, { qos: 0 }, (err) => {
    if (err) {
      console.error(`[SENSOR PRESENÇA] Erro ao publicar em ${TOPIC_PORTA}:`, err.message);
    } else {
      console.log(`[SENSOR PRESENÇA] Publicado em ${TOPIC_PORTA}: ${payload}`);
    }
  });
}

// Executa quando a conexão com o broker Eclipse Mosquitto for estabelecida
client.on('connect', () => {
  // Confirma conexão ativa
  console.log(`[SENSOR PRESENÇA] Conectado ao broker Eclipse Mosquitto em ${BROKER_URL}`);
  // Indica que este nó atua exclusivamente como Publisher (sem subscribe)
  console.log(`[SENSOR PRESENÇA] Publisher ativo para o tópico: ${TOPIC_PORTA}`);

  // Se iniciado com --auto, alterna presença de teste a cada 10 segundos
  if (MODO_AUTO) {
    console.log(`[SENSOR PRESENÇA] Modo --auto ativo: alternando presença a cada 10s.`);
    setInterval(() => {
      estadoPresencaAuto = !estadoPresencaAuto;
      publicarPresenca(estadoPresencaAuto, estadoPresencaAuto ? 'Paciente Auto' : undefined);
    }, 10000);
  } else {
    // Orienta o operador sobre os comandos aceitos no modo interativo CLI
    console.log(`[SENSOR PRESENÇA] Digite "entrar [Nome]" ou "sair" e pressione Enter para publicar (ou use --auto).`);
  }

  // Configura leitura interativa de comandos via terminal
  if (process.stdin && process.stdin.readable) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY),
    });
    // Interpreta comandos digitados pelo usuário
    rl.on('line', (linha) => {
      const comando = linha.trim();
      if (!comando) return;
      const lower = comando.toLowerCase();
      // Aceita "entrar", "entrar Nome", "true" ou "1" para entrada de paciente
      if (lower.startsWith('entrar') || lower === 'true' || lower === '1') {
        const nomeExtraido = comando.replace(/^entrar\s*/i, '').trim();
        publicarPresenca(true, nomeExtraido || 'Paciente CLI');
      } else if (lower === 'sair' || lower === 'false' || lower === '0') {
        // Aceita "sair", "false" ou "0" para liberação da sala
        publicarPresenca(false);
      } else {
        console.log(`[SENSOR PRESENÇA] Comando não reconhecido. Use "entrar [Nome]" ou "sair".`);
      }
    });
    // Mantém processo ativo mesmo se stdin fechar
    rl.on('close', () => {});
  }
});

// Monitora erros de comunicação com o broker Mosquitto
client.on('error', (err) => {
  // Exibe a descrição do erro no console
  console.error(`[SENSOR PRESENÇA] Erro de conexão MQTT:`, err.message);
});
