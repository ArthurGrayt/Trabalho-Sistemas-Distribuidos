// Importa os tipos NextRequest e NextResponse do Next.js para manipular requisições e respostas na API Route
import { NextRequest, NextResponse } from 'next/server';
// Importa a biblioteca 'mqtt' para conectar este endpoint HTTP ao broker MQTT local na porta 1883
import mqtt from 'mqtt';

// Define o endereço local do Broker MQTT (Eclipse Mosquitto) rodando na porta 1883
const BROKER_URL = 'mqtt://127.0.0.1:1883';

// Exporta a função assíncrona POST para tratar requisições enviadas pelo Simulador Mobile (/simulador)
export async function POST(req: NextRequest) {
  // Bloco try/catch para capturar erros de parsing JSON ou falhas de conexão com o broker
  try {
    // Extrai o corpo da requisição HTTP contendo o tópico de destino e a mensagem (payload)
    const body = await req.json();
    // Desestrutura os campos 'topic' e 'message' enviados pelo frontend mobile
    const { topic, message } = body;

    // Valida se o tópico foi informado e é uma string válida
    if (!topic || typeof topic !== 'string') {
      // Retorna status 400 (Bad Request) caso o tópico esteja ausente
      return NextResponse.json(
        { erro: 'O campo "topic" é obrigatório e deve ser uma string.' },
        { status: 400 }
      );
    }

    // Valida se a mensagem foi fornecida no corpo da requisição
    if (message === undefined || message === null) {
      // Retorna status 400 (Bad Request) caso a mensagem esteja vazia
      return NextResponse.json(
        { erro: 'O campo "message" é obrigatório.' },
        { status: 400 }
      );
    }

    // Enriquece o objeto de mensagem com um timestamp ISO único caso seja um objeto, garantindo sincronismo nas 3 réplicas
    const payloadFinal =
      typeof message === 'object'
        ? JSON.stringify({ ...message, timestamp: new Date().toISOString() })
        : String(message);

    // Cria uma Promise para aguardar a conexão ao broker MQTT e a confirmação do publish antes de responder HTTP 200
    await new Promise<void>((resolve, reject) => {
      // Conecta ao broker MQTT local com um clientId exclusivo para a ponte HTTP-MQTT
      const client = mqtt.connect(BROKER_URL, {
        // Identifica este publicador nos logs do broker Eclipse Mosquitto
        clientId: `bridge_http_mqtt_${Math.random().toString(16).slice(2, 7)}`,
        // Define timeout de conexão de 2500ms para evitar travamento caso o broker esteja desligado
        connectTimeout: 2500,
      });

      // Define um temporizador de segurança para encerrar a tentativa caso o broker não responda
      const timeout = setTimeout(() => {
        // Força o encerramento do cliente MQTT em caso de timeout
        client.end(true);
        // Rejeita a promessa informando tempo limite excedido
        reject(new Error('Timeout ao conectar ao Broker MQTT em 127.0.0.1:1883'));
      }, 2500);

      // Evento disparado assim que a conexão com o broker MQTT é estabelecida
      client.on('connect', () => {
        // Publica o payload JSON no tópico solicitado com QoS 0
        client.publish(topic, payloadFinal, { qos: 0 }, (err) => {
          // Limpa o temporizador de segurança
          clearTimeout(timeout);
          // Encerra a conexão do cliente da ponte após publicar
          client.end();
          // Verifica se ocorreu erro durante o publish
          if (err) {
            // Rejeita a promessa caso o publish falhe
            reject(err);
          } else {
            // Resolve a promessa confirmando a entrega ao broker
            resolve();
          }
        });
      });

      // Captura erros de rede (como ECONNREFUSED se o broker não estiver rodando)
      client.on('error', (err) => {
        // Limpa o temporizador de segurança
        clearTimeout(timeout);
        // Encerra o cliente MQTT imediatamente
        client.end(true);
        // Rejeita a promessa repassando o erro de rede
        reject(err);
      });
    });

    // Retorna status HTTP 200 confirmando que a mensagem foi publicada no Broker MQTT com sucesso
    return NextResponse.json(
      {
        sucesso: true,
        topic,
        payload: JSON.parse(payloadFinal),
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    // Extrai a mensagem de erro caso seja uma instância de Error
    const mensagemErro = error instanceof Error ? error.message : 'Erro interno ao publicar no MQTT';
    // Retorna status HTTP 500 detalhando a falha para exibição no toast do simulador mobile
    return NextResponse.json(
      { sucesso: false, erro: mensagemErro },
      { status: 500 }
    );
  }
}

