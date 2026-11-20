// Importa a biblioteca 'mqtt' para publicar telemetria cardíaca ao broker Eclipse Mosquitto
import mqtt from 'mqtt';
// Importa o módulo nativo 'readline' para permitir publicação manual interativa via CLI
import * as readline from 'readline';

// Define o endereço do broker MQTT Eclipse Mosquitto rodando na porta 1883
const BROKER_URL = 'mqtt://127.0.0.1:1883';
// Define o tópico MQTT de publicação da frequência cardíaca (BPM) da Sala 1
const TOPIC_BPM = 'clinica/sala1/bpm';
// Verifica se o sensor foi iniciado com a flag --auto para publicação periódica automática
const MODO_AUTO = process.argv.includes('--auto');

// Inicializa o cliente MQTT com identificação única de publicador cardíaco
const client = mqtt.connect(BROKER_URL, {
  // Gera um clientId exclusivo para o sensor de BPM no broker Eclipse Mosquitto
  clientId: `sensor_bpm_${Math.random().toString(16).slice(2, 6)}`,
});

// Função auxiliar que publica uma leitura de BPM com timestamp único determinístico
function publicarBpm(valorBpm: number): void {
  // Arredonda e limita o valor para a faixa clínica de 60 a 160 BPM
  const bpmNormalizado = Math.max(60, Math.min(160, Math.round(valorBpm)));
  // Monta o payload JSON com o BPM e timestamp ISO compartilhado
  const payload = JSON.stringify({
    // Frequência cardíaca medida
    bpm: bpmNormalizado,
    // Carimbo temporal único do evento para sincronização de Quorum
    timestamp: new Date().toISOString(),
  });
  // Publica no tópico MQTT com QoS 0 (papel estrito de Publisher)
  client.publish(TOPIC_BPM, payload, { qos: 0 }, (err) => {
    // Registra erro caso falhe o envio ao broker
    if (err) {
      console.error(`[SENSOR BPM] Erro ao publicar em ${TOPIC_BPM}:`, err.message);
    } else {
      // Confirma o pacote publicado no console
      console.log(`[SENSOR BPM] Publicado em ${TOPIC_BPM}: ${payload}`);
    }
  });
}

// Registra o callback executado após conectar ao broker Eclipse Mosquitto
client.on('connect', () => {
  // Confirma conexão ativa do sensor cardíaco
  console.log(`[SENSOR BPM] Conectado ao broker Eclipse Mosquitto em ${BROKER_URL}`);
  // Indica que este nó atua exclusivamente como Publisher (sem subscribe)
  console.log(`[SENSOR BPM] Publisher ativo para o tópico: ${TOPIC_BPM}`);

  // Se iniciado com --auto, publica leituras simuladas a cada 5 segundos
  if (MODO_AUTO) {
    // Informa que o modo de geração periódica está ativo
    console.log(`[SENSOR BPM] Modo --auto ativo: publicando telemetria a cada 5s.`);
    // Agenda publicação automática entre 72 e 132 BPM para demonstrações autônomas
    setInterval(() => {
      const bpmSimulado = Math.floor(72 + Math.random() * 61);
      publicarBpm(bpmSimulado);
    }, 5000);
  } else {
    // Orienta o operador sobre o uso interativo sem interferir no Simulador Mobile
    console.log(`[SENSOR BPM] Digite um valor em BPM (60-160) e pressione Enter para publicar (ou use --auto).`);
  }

  // Configura interface CLI para publicação manual sob demanda via terminal
  if (process.stdin && process.stdin.readable) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY),
    });
    // Processa cada linha digitada no terminal
    rl.on('line', (linha) => {
      const valor = Number(linha.trim());
      // Valida se o valor digitado é um número válido
      if (!Number.isNaN(valor) && linha.trim() !== '') {
        publicarBpm(valor);
      } else if (linha.trim() !== '') {
        console.log(`[SENSOR BPM] Valor inválido "${linha.trim()}". Informe um número entre 60 e 160.`);
      }
    });
    // Impede encerramento caso stdin seja fechado pelo gerenciador de processos
    rl.on('close', () => {});
  }
});

// Captura erros de transporte ou conexão com o Mosquitto
client.on('error', (err) => {
  // Loga o erro de forma clara
  console.error(`[SENSOR BPM] Erro de conexão MQTT:`, err.message);
});
