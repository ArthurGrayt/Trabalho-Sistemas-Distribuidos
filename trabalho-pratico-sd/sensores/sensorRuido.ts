// Importa a biblioteca 'mqtt' para publicar telemetria acústica ao broker Eclipse Mosquitto
import mqtt from 'mqtt';
// Importa o módulo nativo 'readline' para permitir publicação manual interativa via CLI
import * as readline from 'readline';

// Define o endereço do broker MQTT Eclipse Mosquitto rodando na porta 1883
const BROKER_URL = 'mqtt://127.0.0.1:1883';
// Define o tópico MQTT de publicação de ruído da Sala 1
const TOPIC_RUIDO = 'clinica/sala1/ruido';
// Verifica se o sensor foi iniciado com a flag --auto para publicação periódica automática
const MODO_AUTO = process.argv.includes('--auto');

// Conecta ao broker Eclipse Mosquitto atribuindo um clientId exclusivo para este publicador
const client = mqtt.connect(BROKER_URL, {
  // Identifica o processo como nó publicador de ruído nos logs do broker
  clientId: `sensor_ruido_${Math.random().toString(16).slice(2, 6)}`,
});

// Função auxiliar que publica uma leitura de ruído em dB com timestamp único determinístico
function publicarRuido(valorDb: number): void {
  // Arredonda e limita o valor para a faixa clínica realista de 40 a 120 dB
  const dbNormalizado = Math.max(40, Math.min(120, Math.round(valorDb)));
  // Monta o payload JSON com valor em dB e timestamp ISO compartilhado entre réplicas
  const payload = JSON.stringify({
    // Nível acústico medido
    db: dbNormalizado,
    // Carimbo temporal único do evento para sincronização de Quorum
    timestamp: new Date().toISOString(),
  });
  // Publica a mensagem no tópico MQTT com QoS 0 (papel estrito de Publisher)
  client.publish(TOPIC_RUIDO, payload, { qos: 0 }, (err) => {
    // Reporta erro de publicação caso o broker não esteja acessível
    if (err) {
      console.error(`[SENSOR RUÍDO] Erro ao publicar em ${TOPIC_RUIDO}:`, err.message);
    } else {
      // Confirma o envio no terminal do sensor
      console.log(`[SENSOR RUÍDO] Publicado em ${TOPIC_RUIDO}: ${payload}`);
    }
  });
}

// Callback executado quando a conexão TCP/MQTT com o Eclipse Mosquitto é estabelecida
client.on('connect', () => {
  // Informa o status de conexão do nó sensor
  console.log(`[SENSOR RUÍDO] Conectado ao broker Eclipse Mosquitto em ${BROKER_URL}`);
  // Indica que este nó atua exclusivamente como Publisher (sem subscribe)
  console.log(`[SENSOR RUÍDO] Publisher ativo para o tópico: ${TOPIC_RUIDO}`);

  // Se iniciado com --auto, publica leituras simuladas a cada 5 segundos
  if (MODO_AUTO) {
    // Informa que o modo de publicação automática periódica está habilitado
    console.log(`[SENSOR RUÍDO] Modo --auto ativo: publicando telemetria a cada 5s.`);
    // Agenda publicação periódica de valores entre 55 dB e 92 dB para testes autônomos
    setInterval(() => {
      const dbSimulado = Math.floor(55 + Math.random() * 38);
      publicarRuido(dbSimulado);
    }, 5000);
  } else {
    // Orienta o operador sobre o uso interativo sem interferir no Simulador Mobile
    console.log(`[SENSOR RUÍDO] Digite um valor em dB (40-120) e pressione Enter para publicar (ou use --auto).`);
  }

  // Configura leitura interativa do terminal quando disponível para publicação sob demanda
  if (process.stdin && process.stdin.readable) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY),
    });
    // Processa cada linha digitada pelo usuário no terminal
    rl.on('line', (linha) => {
      const valor = Number(linha.trim());
      // Valida se o texto digitado corresponde a um número finito
      if (!Number.isNaN(valor) && linha.trim() !== '') {
        publicarRuido(valor);
      } else if (linha.trim() !== '') {
        console.log(`[SENSOR RUÍDO] Valor inválido "${linha.trim()}". Informe um número entre 40 e 120.`);
      }
    });
    // Mantém o processo conectado ao MQTT caso stdin seja fechado (ex: execução sob concurrently)
    rl.on('close', () => {});
  }
});

// Monitora erros de rede ou indisponibilidade do broker Mosquitto
client.on('error', (err) => {
  // Exibe a mensagem de erro sem encerrar abruptamente o processo
  console.error(`[SENSOR RUÍDO] Erro de conexão MQTT:`, err.message);
});
