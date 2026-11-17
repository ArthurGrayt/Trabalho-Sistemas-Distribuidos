// Importa a biblioteca oficial do gRPC para Node.js
import * as grpc from '@grpc/grpc-js';
// Importa o carregador de arquivos Protobuf
import * as protoLoader from '@grpc/proto-loader';
// Importa o módulo nativo path para resolução de diretórios
import path from 'path';
// Importa o módulo nativo fs para verificar a existência do arquivo proto
import fs from 'fs';

// Lista de possíveis locais onde o arquivo diverterapia.proto pode ser encontrado
const POSSIVEIS_CAMINHOS_PROTO = [
  // Caminho quando executado diretamente na pasta cliente-dashboard
  path.join(process.cwd(), 'proto', 'diverterapia.proto'),
  // Caminho quando executado na raiz do projeto
  path.join(process.cwd(), 'cliente-dashboard', 'proto', 'diverterapia.proto'),
  // Caminho relativo ao diretório pai
  path.join(process.cwd(), '..', 'proto', 'diverterapia.proto'),
  // Caminho relativo ao módulo atual
  path.resolve(__dirname, '../../proto/diverterapia.proto'),
];

// Localiza o primeiro caminho existente para o arquivo .proto
const PROTO_PATH = POSSIVEIS_CAMINHOS_PROTO.find((p) => fs.existsSync(p)) || POSSIVEIS_CAMINHOS_PROTO[0];

// Carrega as definições do contrato Protobuf com suporte a camelCase e valores padrão
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  // Mantém nomes de campos em camelCase definidos no .proto
  keepCase: true,
  // Trata inteiros de 64 bits como strings para evitar perda de precisão
  longs: String,
  // Trata enumeradores como strings
  enums: String,
  // Garante que campos opcionais tenham valores padrão
  defaults: true,
  // Habilita suporte a campos alternativos oneofs
  oneofs: true,
});

// Extrai o pacote 'diverterapia' do descritor de tipos gRPC
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
// Obtém a definição do serviço do Middleware Clínico
const MiddlewareClinico = protoDescriptor.diverterapia.MiddlewareClinico;

// Configuração das portas gRPC dos 3 controladores do Middleware
export const CONTROLADORES_GRPC = [
  // Controlador 1 (Nó Primário)
  { id: 'controlador-1', nome: 'Controlador 1', porta: 3001, endereco: '127.0.0.1:3001' },
  // Controlador 2 (Nó Secundário de Failover)
  { id: 'controlador-2', nome: 'Controlador 2', porta: 3002, endereco: '127.0.0.1:3002' },
  // Controlador 3 (Nó Terciário com Injeção Bizantina)
  { id: 'controlador-3', nome: 'Controlador 3', porta: 3003, endereco: '127.0.0.1:3003' },
];

// Mapa em memória para reutilizar os stubs de cliente gRPC criados
const clientesCache: Map<number, any> = new Map();

// Função que obtém ou instancia um cliente gRPC para a porta especificada
export function getGrpcClient(porta: number) {
  // Verifica se o cliente já existe no cache
  if (!clientesCache.has(porta)) {
    // Cria uma nova instância do stub gRPC usando credenciais inseguras locais
    const client = new MiddlewareClinico(`127.0.0.1:${porta}`, grpc.credentials.createInsecure());
    // Armazena a instância criada no cache
    clientesCache.set(porta, client);
  }
  // Retorna o stub gRPC pronto para uso
  return clientesCache.get(porta);
}

// Função auxiliar com timeout para invocar o método gRPC ObterStatus
export function rpcObterStatus(porta: number, timeoutMs = 1500): Promise<any> {
  // Retorna uma Promise encapsulando a chamada RPC com temporizador
  return new Promise((resolve, reject) => {
    // Obtém o cliente gRPC da porta solicitada
    const client = getGrpcClient(porta);
    // Cria os metadados do gRPC
    const metadata = new grpc.Metadata();
    // Configura o prazo limite (deadline) da chamada gRPC
    const deadline = new Date(Date.now() + timeoutMs);

    // Invoca o método remoto ObterStatus passando mensagem vazia
    client.ObterStatus({}, metadata, { deadline }, (err: any, response: any) => {
      // Se ocorreu erro de comunicação ou timeout
      if (err) {
        // Rejeita a Promise com o erro do gRPC
        reject(err);
      } else {
        // Resolve a Promise com o envelope de dados retornado
        resolve(response);
      }
    });
  });
}

// Função auxiliar com timeout para invocar o método gRPC AtivarModoCalmaManual
export function rpcAtivarModoCalmaManual(porta: number, origem: string, timeoutMs = 1500): Promise<any> {
  // Retorna uma Promise encapsulando a mutação remota de estado
  return new Promise((resolve, reject) => {
    // Obtém o cliente gRPC da porta especificada
    const client = getGrpcClient(porta);
    // Cria os metadados da chamada
    const metadata = new grpc.Metadata();
    // Define o limite de tempo para a operação
    const deadline = new Date(Date.now() + timeoutMs);

    // Invoca o método remoto AtivarModoCalmaManual enviando a origem da requisição
    client.AtivarModoCalmaManual({ origem }, metadata, { deadline }, (err: any, response: any) => {
      // Verifica se houve falha na invocação
      if (err) {
        // Rejeita a Promise com o erro gRPC
        reject(err);
      } else {
        // Resolve a Promise com a resposta de confirmação
        resolve(response);
      }
    });
  });
}

// Função auxiliar com timeout para invocar o método genérico InvocarMetodo
export function rpcInvocarMetodo(
  porta: number,
  metodo: string,
  origem: string,
  parametros?: any,
  timeoutMs = 1500
): Promise<any> {
  // Retorna uma Promise que executa o procedimento remoto genérico
  return new Promise((resolve, reject) => {
    // Obtém o cliente gRPC correspondente
    const client = getGrpcClient(porta);
    // Instancia os metadados gRPC
    const metadata = new grpc.Metadata();
    // Calcula o prazo máximo para receber a resposta
    const deadline = new Date(Date.now() + timeoutMs);

    // Monta o payload gRPC com os dados do método e parâmetros
    const payload = {
      metodo,
      origem,
      parametros: {
        corLuz: parametros?.corLuz || '',
        somSpeaker: parametros?.somSpeaker || '',
        textoDisplay: parametros?.textoDisplay || '',
      },
    };

    // Invoca o método RPC InvocarMetodo no servidor
    client.InvocarMetodo(payload, metadata, { deadline }, (err: any, response: any) => {
      // Se ocorreu erro de rede ou de execução
      if (err) {
        // Rejeita a Promise
        reject(err);
      } else {
        // Resolve com a resposta do controlador
        resolve(response);
      }
    });
  });
}

// Função auxiliar para alternar a injeção de Falha Bizantina no Controlador 3
export function rpcToggleBizantino(timeoutMs = 1500): Promise<any> {
  // Retorna uma Promise executando a alternância no nó 3 (porta 3003)
  return new Promise((resolve, reject) => {
    // Obtém o cliente do nó 3
    const client = getGrpcClient(3003);
    // Cria metadados gRPC
    const metadata = new grpc.Metadata();
    // Define o deadline
    const deadline = new Date(Date.now() + timeoutMs);

    // Dispara a chamada RPC ToggleBizantino
    client.ToggleBizantino({}, metadata, { deadline }, (err: any, response: any) => {
      // Trata erros de chamada
      if (err) {
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
}

// Função de alto nível: Executa ObterStatus com Failover automático (3001 -> 3002 -> 3003)
export async function obterStatusComFailover() {
  // Array com as portas ordenadas por prioridade de contingência
  const portas = [3001, 3002, 3003];
  // Itera sobre as portas tentando a comunicação gRPC
  for (const porta of portas) {
    try {
      // Tenta obter o status do nó atual
      const dados = await rpcObterStatus(porta, 1200);
      // Retorna os dados assim que o primeiro nó responder
      return { ...dados, obtidoViaFailoverNaPorta: porta };
    } catch {
      // Se falhar, segue para a próxima réplica gRPC
    }
  }
  // Lança erro caso todos os nós gRPC estejam inacessíveis
  throw new Error('Todas as réplicas gRPC do Middleware estão inacessíveis.');
}

// Função de alto nível: Ativa Modo Calma com Failover automático (3001 -> 3002 -> 3003)
export async function ativarModoCalmaComFailover(origem: string) {
  // Portas de contingência
  const portas = [3001, 3002, 3003];
  // Itera pelas réplicas
  for (const porta of portas) {
    try {
      // Tenta acionar o modo calma via gRPC na réplica
      const dados = await rpcAtivarModoCalmaManual(porta, origem, 1500);
      // Retorna sucesso
      return { ...dados, executadoNaPorta: porta };
    } catch {
      // Continua para o próximo nó em caso de falha
    }
  }
  // Lança erro se nenhum nó responder
  throw new Error('Falha ao ativar modo calma: todos os controladores gRPC estão offline.');
}

// Função de alto nível: Invoca Método com Failover automático (3001 -> 3002 -> 3003)
export async function invocarMetodoComFailover(metodo: string, origem: string, parametros?: any) {
  // Portas de contingência
  const portas = [3001, 3002, 3003];
  // Itera pelas réplicas
  for (const porta of portas) {
    try {
      // Tenta invocar o procedimento remoto via gRPC
      const dados = await rpcInvocarMetodo(porta, metodo, origem, parametros, 1500);
      // Retorna sucesso
      return { ...dados, executadoNaPorta: porta };
    } catch {
      // Continua para a próxima réplica
    }
  }
  // Lança erro se nenhum controlador estiver disponível
  throw new Error('Falha ao invocar método: todos os nós gRPC falharam.');
}
