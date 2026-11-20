// Importa a biblioteca oficial do gRPC para Node.js
import * as grpc from '@grpc/grpc-js';
// Importa o carregador de arquivos Protobuf
import * as protoLoader from '@grpc/proto-loader';
// Importa o módulo nativo path para resolução de diretórios
import path from 'path';
// Importa o módulo nativo fs para verificar a existência do arquivo proto único
import fs from 'fs';

// Lista ordenada de possíveis locais do contrato único proto/diverterapia.proto
const POSSIVEIS_CAMINHOS_PROTO = [
  // Caminho padrão quando o Next.js roda dentro de cliente-dashboard apontando para a raiz
  path.join(process.cwd(), '..', 'proto', 'diverterapia.proto'),
  // Caminho alternativo caso process.cwd() já seja a raiz do projeto
  path.join(process.cwd(), 'proto', 'diverterapia.proto'),
  // Caminho relativo ao arquivo compilado/fonte no servidor Next.js
  path.resolve(__dirname, '../../../../proto/diverterapia.proto'),
];

// Localiza o primeiro caminho existente para o arquivo .proto único
const PROTO_PATH = POSSIVEIS_CAMINHOS_PROTO.find((p) => fs.existsSync(p)) || POSSIVEIS_CAMINHOS_PROTO[0];

// Carrega as definições do contrato Protobuf preservando camelCase e valores padrão
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  // Mantém nomes de campos em camelCase definidos no .proto
  keepCase: true,
  // Trata inteiros de 64 bits como strings para evitar perda de precisão no JS
  longs: String,
  // Trata enumeradores como strings legíveis
  enums: String,
  // Garante que campos opcionais possuam valores padrão
  defaults: true,
  // Habilita suporte a campos alternativos oneofs
  oneofs: true,
});

// Extrai o pacote 'diverterapia' do descritor carregado do gRPC
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
// Obtém o construtor do serviço MiddlewareClinico definido no contrato .proto
const MiddlewareClinico = protoDescriptor.diverterapia.MiddlewareClinico;

// Configuração oficial dos 3 nós controladores gRPC do cluster
export const CONTROLADORES_GRPC = [
  // Controlador 1 (Nó Líder Primário)
  { id: 'controlador-1', nome: 'Controlador 1', porta: 3001, url: '/api/controlador/1', endereco: '127.0.0.1:3001' },
  // Controlador 2 (Réplica Honesta e Líder Interino em Failover)
  { id: 'controlador-2', nome: 'Controlador 2', porta: 3002, url: '/api/controlador/2', endereco: '127.0.0.1:3002' },
  // Controlador 3 (Réplica com Injeção Bizantina Toggleável)
  { id: 'controlador-3', nome: 'Controlador 3', porta: 3003, url: '/api/controlador/3', endereco: '127.0.0.1:3003' },
];

// Interface que descreve o diagnóstico individual real de cada nó do cluster
export interface DiagnosticoNoCluster {
  // Identificador do controlador (ex: controlador-1)
  id: string;
  // Rótulo amigável do nó
  nome: string;
  // Porta gRPC do controlador
  porta: number;
  // Prefixo de rota HTTP no Gateway Next.js
  url: string;
  // Status real de conectividade gRPC do nó
  online: boolean;
  // Integridade reportada (LIDER_HONESTO, HONESTO, LIDER_INTERINO, FALHA_BIZANTINA ou OFFLINE)
  integridade: string;
  // Identificador da instância MongoDB associada ao nó
  armazenamentoId: string;
  // Flag indicando se a falha por parada simulada (Crash Fault) está ativa
  falhaParadaSimulada?: boolean;
  // Dados completos da resposta ObterStatus quando online (uso interno do Gateway)
  dados?: any;
}

// Mapa em memória para reutilizar os stubs gRPC e evitar abertura repetida de canais HTTP/2
const clientesCache: Map<number, any> = new Map();

// Função que obtém ou instancia um cliente gRPC para a porta informada
export function getGrpcClient(porta: number) {
  // Cria o stub caso ainda não exista no cache
  if (!clientesCache.has(porta)) {
    const client = new MiddlewareClinico(`127.0.0.1:${porta}`, grpc.credentials.createInsecure());
    clientesCache.set(porta, client);
  }
  // Retorna o stub reutilizável
  return clientesCache.get(porta);
}

// Invoca o método remoto ObterStatus com prazo limite configurado
export function rpcObterStatus(porta: number, timeoutMs = 1500): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = getGrpcClient(porta);
    const metadata = new grpc.Metadata();
    const deadline = new Date(Date.now() + timeoutMs);

    client.ObterStatus({}, metadata, { deadline }, (err: any, response: any) => {
      if (err) {
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
}

// Invoca o método remoto AtivarModoCalmaManual com prazo limite configurado
export function rpcAtivarModoCalmaManual(porta: number, origem: string, timeoutMs = 1500): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = getGrpcClient(porta);
    const metadata = new grpc.Metadata();
    const deadline = new Date(Date.now() + timeoutMs);

    client.AtivarModoCalmaManual({ origem }, metadata, { deadline }, (err: any, response: any) => {
      if (err) {
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
}

// Invoca o método remoto genérico InvocarMetodo com parâmetros dos atuadores
export function rpcInvocarMetodo(
  porta: number,
  metodo: string,
  origem: string,
  parametros?: any,
  timeoutMs = 1500
): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = getGrpcClient(porta);
    const metadata = new grpc.Metadata();
    const deadline = new Date(Date.now() + timeoutMs);

    const payload = {
      metodo,
      origem,
      parametros: {
        corLuz: parametros?.corLuz || '',
        somSpeaker: parametros?.somSpeaker || '',
        textoDisplay: parametros?.textoDisplay || '',
      },
    };

    client.InvocarMetodo(payload, metadata, { deadline }, (err: any, response: any) => {
      if (err) {
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
}

// Invoca o método remoto ToggleBizantino diretamente no Controlador 3 (porta 3003)
export function rpcToggleBizantino(timeoutMs = 1500): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = getGrpcClient(3003);
    const metadata = new grpc.Metadata();
    const deadline = new Date(Date.now() + timeoutMs);

    client.ToggleBizantino({}, metadata, { deadline }, (err: any, response: any) => {
      if (err) {
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
}

// Invoca o método remoto AlternarStatusOperacional em qualquer controlador para simular Crash ou Recovery
export function rpcAlternarStatusOperacional(porta: number, timeoutMs = 1500): Promise<any> {
  // Retorna Promise tipada para o Gateway da API
  return new Promise((resolve, reject) => {
    // Obtém stub gRPC do controlador correspondente
    const client = getGrpcClient(porta);
    // Cria metadados gRPC
    const metadata = new grpc.Metadata();
    // Define prazo de resposta
    const deadline = new Date(Date.now() + timeoutMs);

    // Dispara a chamada RPC AlternarStatusOperacional
    client.AlternarStatusOperacional({}, metadata, { deadline }, (err: any, response: any) => {
      // Rejeita em caso de erro
      if (err) {
        reject(err);
      } else {
        // Resolve com a resposta do nó
        resolve(response);
      }
    });
  });
}

// Consulta todos os 3 nós gRPC em paralelo para obter a saúde real e integridade do cluster
export async function obterDiagnosticoCluster(timeoutMs = 800): Promise<DiagnosticoNoCluster[]> {
  // Dispara ObterStatus simultaneamente para as portas 3001, 3002 e 3003
  const resultados = await Promise.allSettled(
    CONTROLADORES_GRPC.map((cfg) => rpcObterStatus(cfg.porta, timeoutMs))
  );

  // Mapeia cada resultado para o objeto padronizado de diagnóstico
  return CONTROLADORES_GRPC.map((cfg, index) => {
    const res = resultados[index];
    if (res.status === 'fulfilled') {
      const dados = res.value;
      return {
        id: cfg.id,
        nome: cfg.nome,
        porta: cfg.porta,
        url: cfg.url,
        online: true,
        integridade: String(dados?.integridade || 'HONESTO'),
        armazenamentoId: String(dados?.armazenamentoId || ''),
        dados,
      };
    }

    // Quando o nó gRPC está desligado ou inalcançável, marca online: false
    return {
      id: cfg.id,
      nome: cfg.nome,
      porta: cfg.porta,
      url: cfg.url,
      online: false,
      integridade: 'OFFLINE',
      armazenamentoId: '',
    };
  });
}

// Obtém o status consolidado com Failover (3001 -> 3002 -> 3003), rejeitando nó bizantino
export async function obterStatusComFailover() {
  const portas = [3001, 3002, 3003];
  for (const porta of portas) {
    try {
      const dados = await rpcObterStatus(porta, 1200);
      // Nunca aceita um nó que declara FALHA_BIZANTINA como fonte de verdade do cliente
      if (dados?.integridade === 'FALHA_BIZANTINA') {
        continue;
      }
      return { ...dados, obtidoViaFailoverNaPorta: porta };
    } catch {
      // Segue para a próxima réplica gRPC caso haja falha ou timeout
    }
  }
  throw new Error('Todas as réplicas íntegras do Middleware estão inacessíveis.');
}

// Executa AtivarModoCalmaManual com Failover automático (3001 -> 3002 -> 3003)
export async function ativarModoCalmaComFailover(origem: string) {
  const portas = [3001, 3002, 3003];
  for (const porta of portas) {
    try {
      const dados = await rpcAtivarModoCalmaManual(porta, origem, 1500);
      // Ignora o nó caso tenha recusado por estar em estado bizantino
      if (dados?.sucesso === false) {
        continue;
      }
      return { ...dados, executadoNaPorta: porta };
    } catch {
      // Continua para o próximo nó em caso de falha de rede
    }
  }
  throw new Error('Falha ao ativar modo calma: todos os controladores gRPC falharam.');
}

// Executa InvocarMetodo com Failover automático (3001 -> 3002 -> 3003)
export async function invocarMetodoComFailover(metodo: string, origem: string, parametros?: any) {
  const portas = [3001, 3002, 3003];
  for (const porta of portas) {
    try {
      const dados = await rpcInvocarMetodo(porta, metodo, origem, parametros, 1500);
      // Ignora o nó caso tenha recusado execução por falha bizantina
      if (dados?.sucesso === false) {
        continue;
      }
      return { ...dados, executadoNaPorta: porta };
    } catch {
      // Continua para a próxima réplica disponível
    }
  }
  throw new Error('Falha ao invocar método: todos os nós gRPC falharam.');
}
