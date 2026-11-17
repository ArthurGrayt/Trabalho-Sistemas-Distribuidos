# Manual Técnico e Arquitetural do Middleware IoT Diverterapia
> **Sistema Distribuído de Regulação Sensorial Pediátrica**  
> *Baseado na metodologia Diátaxis (Tutorial, How-To, Reference e Explanation)*

---

## 📌 PARTE 1: Visão Geral e Mapa Mental do Sistema

### 1.1 O que é o Diverterapia e qual problema ele resolve?
O **Diverterapia** é uma plataforma clínica e terapêutica desenvolvida para **Salas Pediátricas Inteligentes**, com foco no acolhimento de crianças com Transtorno do Espectro Autista (TEA), Transtorno do Déficit de Atenção com Hiperatividade (TDAH) e sobrecarga sensorial.

Em ambientes hospitalares ou de terapia, estímulos desregulados (como sirenes, ruído elevado, agitação motora ou luzes frias em excesso) podem desencadear crises sensoriais agudas. O Diverterapia atua como um **Middleware IoT Distribuído de Alta Confiabilidade** que:
1. **Monitora continuamente** a criança via telemetria acústica (decibéis) e fisiológica (frequência cardíaca/BPM).
2. **Gerencia a entrada e a fila de espera** de forma automatizada através de tags RFID/check-in mobile.
3. **Controla o ambiente físico** em tempo real através de 3 atuadores:
   - **Iluminação RGB:** Ajusta cores calmantes ou vibrantes conforme o protocolo.
   - **Smart Speaker:** Emite frequências calmantes (ruído branco), playlists favoritas ou isolamento acústico.
   - **Display da Porta:** Exibe avisos clínicos para a equipe externa (ex: *"Regulação em Curso - Não Entre"*).
4. **Garante Tolerância a Falhas e Consenso:** Utiliza um cluster de **3 Controladores com Eleição de Líder e Quorum 2x1** com **3 instâncias independentes de banco de dados (MongoDB)**, neutralizando quedas de servidores e adulterações maliciosas (**Falhas Bizantinas**).

---

### 1.2 Diagrama Arquitetural de Ponta a Ponta

```mermaid
flowchart TD
    subgraph SENSORIAMENTO["Camada de Percepção (IoT / Simulador Mobile)"]
        S_RUIDO["Sensor de Ruído\n(MQTT: clinica/sala1/ruido)"]
        S_BPM["Sensor de BPM / Pulseira\n(MQTT: clinica/sala1/bpm)"]
        S_PRES["Sensor de Presença / Porta\n(MQTT: clinica/sala1/porta)"]
        SIM_MOB["Simulador Mobile / Recepção\n(POST /api/mqtt/publish)"]
    end

    subgraph BROKER["Barramento Publish/Subscribe"]
        MOSQ["Eclipse Mosquitto / Broker MQTT\nPorta 1883"]
    end

    subgraph MIDDLEWARE["Middleware Distribuído (Cluster gRPC)"]
        CTRL1["Controlador 1 (LÍDER)\ngRPC: 3001"]
        CTRL2["Controlador 2 (RÉPLICA HONESTA)\ngRPC: 3002"]
        CTRL3["Controlador 3 (RÉPLICA BIZANTINA)\ngRPC: 3003"]
    end

    subgraph BANCOS["Camada de Persistência Independente"]
        DB1[("MongoDB 1\nPorta 27017")]
        DB2[("MongoDB 2\nPorta 27018")]
        DB3[("MongoDB 3\nPorta 27019")]
    end

    subgraph ATUADORES["Camada de Atuação Física"]
        A_LUZ["Iluminação RGB\n(clinica/sala1/comando/luz)"]
        A_SOM["Smart Speaker\n(clinica/sala1/comando/som)"]
        A_DISP["Display da Porta\n(clinica/sala1/comando/display)"]
    end

    subgraph CLIENTE["Camada de Aplicação (Next.js 14)"]
        GATEWAY["API Gateway / gRPC Client\n(/api/status | /api/controlador)"]
        DASHBOARD["Dashboard Web Clínico\n(Quorum, Métodos e Auditoria)"]
        MOB_VIEW["Interface Mobile Aluno\n(/simulador)"]
    end

    %% Conexões de Entrada IoT
    S_RUIDO -->|Publish dB| MOSQ
    S_BPM -->|Publish BPM| MOSQ
    S_PRES -->|Publish Presença| MOSQ
    SIM_MOB -->|Publish Check-in| MOSQ

    %% Assinaturas MQTT dos Controladores
    MOSQ -->|Subscribe Telemetria| CTRL1
    MOSQ -->|Subscribe Telemetria| CTRL2
    MOSQ -->|Subscribe Telemetria| CTRL3

    %% Consenso Interno gRPC
    CTRL1 <-->|Consenso: VotarEstado| CTRL2
    CTRL1 <-->|Consenso: VotarEstado (Rejeita Bizantino)| CTRL3
    CTRL1 -->|Consenso: EfetivarEstado| CTRL2
    CTRL1 -->|Consenso: EfetivarEstado| CTRL3

    %% Persistência após Quorum
    CTRL1 -->|Gravação Validada| DB1
    CTRL2 -->|Gravação Validada| DB2
    CTRL3 -->|Gravação Validada| DB3

    %% Comandos de Atuação pós-Consenso
    CTRL1 -->|Ordens Validadas| MOSQ
    MOSQ --> A_LUZ
    MOSQ --> A_SOM
    MOSQ --> A_DISP

    %% Frontend com Gateway gRPC
    GATEWAY <-->|gRPC ObterStatus / InvocarMetodo| CTRL1
    GATEWAY -.->|Failover se Ctrl 1 cair| CTRL2
    DASHBOARD <--> GATEWAY
    MOB_VIEW <--> GATEWAY
```

---

### 1.3 Mapeamento de Componentes: Para que serve cada pasta e arquivo?

| Diretório / Arquivo | Para que serve? | Como funciona na prática? |
| :--- | :--- | :--- |
| `docker-compose.yml` | **Infraestrutura em Containers** | Orquestra o broker Mosquitto (`1883`) e as 3 instâncias isoladas do MongoDB (`27017`, `27018`, `27019`). |
| `proto/diverterapia.proto` | **Contrato de Interface gRPC** | Define formalmente os tipos de dados e os métodos dos serviços `MiddlewareClinico` e `ConsensoInterno`. |
| `controladores/controlador1.ts` | **Controlador 1 (Líder do Cluster)** | Escuta MQTT, recebe requisições do Next.js, orquestra a votação de Quorum 2x1 via gRPC e coordena o commit nos 3 MongoDBs. |
| `controladores/controlador2.ts` | **Controlador 2 (Réplica Honesta)** | Réplica redundante. Vota de forma íntegra no consenso e grava o estado aprovado no MongoDB 2. Assume em caso de failover do Líder. |
| `controladores/controlador3.ts` | **Controlador 3 (Réplica Bizantina)** | Réplica para injeção de falhas. Quando ativada, retorna valores forjados (ruído 999 dB, BPM 250) para testar o descarte pelo Quorum. |
| `sensores/sensorRuido.ts` | **Simulador IoT de Ruído Acústico** | Publica periodicamente valores em decibéis (`clinica/sala1/ruido`). |
| `sensores/sensorBPM.ts` | **Simulador IoT de Pulseira Cardíaca** | Publica periodicamente valores de frequência cardíaca (`clinica/sala1/bpm`). |
| `sensores/sensorPresenca.ts` | **Simulador de Tag/Presença Física** | Publica entrada/saída de pacientes na sala (`clinica/sala1/porta`). |
| `atuadores/iluminacao.ts` | **Atuador Físico de Iluminação** | Escuta `clinica/sala1/comando/luz` e exibe o estado das lâmpadas RGB. |
| `atuadores/smartSpeaker.ts` | **Atuador Físico de Som** | Escuta `clinica/sala1/comando/som` e simula a reprodução de trilhas ou ruído branco. |
| `atuadores/displayPorta.ts` | **Atuador Físico de Visor** | Escuta `clinica/sala1/comando/display` e projeta as mensagens para a equipe externa. |
| `cliente-dashboard/src/lib/grpcClient.ts` | **Cliente gRPC do Next.js** | Inicializa os stubs de conexão com `3001`, `3002` e `3003`, provendo funções de chamada com failover. |
| `cliente-dashboard/src/app/api/status/route.ts` | **Gateway de Telemetria** | Endpoint consumido pelo dashboard e pelo celular para ler o estado aprovado pelo Líder. |
| `cliente-dashboard/src/app/page.tsx` | **Dashboard Clínico Web** | Interface dos terapeutas: exibe status dos nós, quorum, histórico e botões de comando. |
| `cliente-dashboard/src/app/simulador/page.tsx` | **Simulador Mobile dos Alunos** | Interface responsiva mobile-first onde o aluno simula check-in e sensores de BPM/ruído. |

---

## 📘 QUADRANTE 1: Tutorial (Aprender Fazendo / Passo a Passo do Zero)

Este tutorial guia você pelo processo de inicialização e teste de toda a plataforma distribuída a partir do zero.

### Passo 1: Subir os Containers Docker
Na raiz do projeto (`trabalho-pratico-sd`), inicie o broker MQTT e as 3 instâncias de banco de dados:

```bash
# Sobe os 4 containers em segundo plano (-d)
docker compose up -d

# Verifica se os 4 containers estão com status "Up"
docker compose ps
```

Você deverá ver os seguintes containers em execução:
- `mqtt-broker` na porta `1883`
- `mongo1` na porta `27017`
- `mongo2` na porta `27018`
- `mongo3` na porta `27019`

### Passo 2: Instalar as Dependências do Projeto
Certifique-se de que os pacotes necessários estejam instalados na raiz e na pasta do dashboard:

```bash
# Na raiz do projeto:
npm install

# No diretório do frontend Next.js:
cd cliente-dashboard
npm install
cd ..
```

### Passo 3: Iniciar o Sistema Completo
Para executar simultaneamente o broker interno, os 3 controladores, os sensores, os atuadores e o Next.js, utilize o script preparado:

```bash
# Executa todos os nós simultaneamente via concurrently:
npm run start:all
```

> [!TIP]
> **Modo Didático (Terminais Separados):** Se quiser visualizar o terminal de cada nó individualmente durante uma apresentação, abra terminais separados e execute:
> - Terminal 1: `npm run broker` (ou confie no Docker)
> - Terminal 2: `npm run ctrl1` (Líder gRPC porta 3001)
> - Terminal 3: `npm run ctrl2` (Réplica Honesta gRPC porta 3002)
> - Terminal 4: `npm run ctrl3` (Réplica Bizantina gRPC porta 3003)
> - Terminal 5: `npm run atuador:luz`
> - Terminal 6: `npm run atuador:speaker`
> - Terminal 7: `npm run atuador:display`
> - Terminal 8: `cd cliente-dashboard && npm run dev`

### Passo 4: O Primeiro Teste Clínico Ponta a Ponta
1. **Abra o Dashboard no Computador:** Acesse `http://localhost:3000` no navegador.
   - Observe o card de réplicas indicando **Controlador 1 (Líder)** ativo.
   - O visor de Quorum exibirá: *"Quorum 2x1 Validado no Backend"*.
2. **Abra o Simulador Mobile no Smartphone ou em Outra Aba:** Acesse `http://localhost:3000/simulador`.
3. **Simule a Chegada de um Paciente:**
   - No card **Entrada do Paciente**, digite o nome da criança (ex: *"Arthur"*).
   - Escolha a cor favorita *"Azul"* e o estilo musical *"Rock"*.
   - Clique em **Simular Entrada**.
4. **Observe o Fluxo Distribuído Acontecendo:**
   - O celular envia um POST para `/api/mqtt/publish` no tópico `clinica/recepcao/checkin`.
   - O Controlador 1 (Líder) recebe a mensagem MQTT, cria um estado candidato e dispara `VotarEstado` para os controladores 2 e 3 via gRPC.
   - O Controlador 2 vota a favor. O Controlador 3 injeta erro bizantino e é descartado.
   - Com 2 votos a favor, o Líder alcança o **Quorum 2x1**, grava no MongoDB 1, dispara `EfetivarEstado` para os nós 2 e 3 gravarem em seus bancos, e publica nos atuadores.
   - Os atuadores físicos no terminal mostram a lâmpada acendendo em Azul, a música iniciando em Rock e a porta exibindo `> Em Atendimento (Arthur)`.
   - O Dashboard e o Simulador atualizam instantaneamente via WebSocket/Polling sem recarregar a página!

---

## 🛠️ QUADRANTE 2: How-To Guides (Guias Práticos de Operação)

### 2.1 Como demonstrar o Quorum 2x1 e a Rejeição de Falha Bizantina?
**Objetivo:** Provar para os avaliadores que dados corrompidos por um nó malicioso são detectados e descartados antes de irem para o banco de dados.

1. Abra o terminal onde o **Controlador 1** está rodando.
2. Certifique-se de que a falha bizantina está ativa no Controlador 3 (no dashboard, o nó 3 exibe o badge vermelho *"DESCARTADO_BIZANTINO"*).
3. No Simulador Mobile, altere o slider de Ruído para `75 dB`.
4. Observe a saída detalhada no terminal do Controlador 1:
   ```text
   🗳️ [controlador-1] Submetendo estado candidato à votação de Quorum...
    Réplica 2 (:3002): APROVADO (Voto Íntegro)
   ⚠️ Réplica 3 (:3003): DESCARTADO POR FALHA BIZANTINA (Ruído: 999dB, BPM: 250)
   ⚖️ [controlador-1] QUORUM 2x1 ALCANÇADO (2/3 votos): [Líder: APROVADO | Réplica 2: APROVADO]
   ✅ [controlador-1] Estado validado persistido no MongoDB 1 e replicado nas instâncias 2 e 3.
   ```
5. **Resultado Comprovado:** O valor de ruído gravado em todos os bancos de dados é `75 dB` (e não os 999 dB inventados pelo nó traidor).

---

### 2.2 Como simular a Queda de um Nó e Testar o Failover Automático?
**Objetivo:** Provar que o sistema continua operando mesmo se o servidor primário cair.

1. No terminal onde o **Controlador 1** está rodando, pressione `Ctrl + C` para encerrar o processo (simulando falha de hardware ou pane de rede na porta `3001`).
2. Acesse o Dashboard em `http://localhost:3000`.
3. Clique em qualquer preset (ex: **Regulação Sensorial**).
4. Observe o **Console de Auditoria & Failover** na lateral direita da tela:
   ```text
   [METODO] [Cliente 1] Invocando ativarModoCalmaManual() no Controlador 1 (:3001)...
   [FAILOVER] Controlador 1 offline (ECONNREFUSED). Acionando Failover para Controlador 2 (:3002)...
   [INFO] Failover concluído com sucesso via Controlador 2 (:3002) via gRPC.
   ```
5. **Resultado Comprovado:** A sala foi regulada com sucesso e a ordem persistida no MongoDB 2, mantendo alta disponibilidade sem interrupção do atendimento.

---

### 2.3 Como alternar a Réplica 3 entre Modo Honesto e Modo Bizantino?
**Objetivo:** Demonstrar consenso unânime versus consenso com quorum de tolerância a falhas.

1. No Dashboard, localize o card **Réplicas do Middleware (Quorum Backend)**.
2. No bloco do **Controlador 3**, clique no botão **Alternar Modo Bizantino**.
3. O Next.js invoca a RPC `ToggleBizantino` na porta `3003`.
4. Quando o modo bizantino é desativado:
   - O Controlador 3 passa a votar com integridade.
   - O Líder registra nos logs: `QUORUM 3x3 ALCANÇADO — Consenso Unânime`.
   - O card do Controlador 3 no Dashboard passa a exibir o status verde *"CONSENSO_MAIORIA"*.
5. Ao clicar novamente, o nó volta a gerar dados adulterados para fins de auditoria.

---

### 2.4 Como testar a Regulação Sensorial Automática via Telemetria Crítica?
**Objetivo:** Validar as regras autônomas de proteção sensorial da criança.

1. No Simulador Mobile (`/simulador`), mova o slider de **Frequência Cardíaca** para `128 BPM` (ou o de **Ruído Acústico** para `90 dB`).
2. Imediatamente observe os atuadores e o Dashboard:
   - A automação detecta a sobrecarga sensorial ($\text{Ruído} > 85\text{ dB}$ ou $\text{BPM} > 120$).
   - O ambiente entra em **Protocolo de Regulação Sensorial (Combinação 1)**:
     - Lâmpada: **Azul / Calmante**
     - Smart Speaker: **Frequência Calmante (Ruído Branco)**
     - Visor da Porta: **> Regulação em Curso (Não Entre)**
3. Reduza os valores para níveis seguros (`60 dB` e `75 BPM`).
4. Após o período de estabilização, o ambiente restaura automaticamente o modo de atendimento normal.

---

### 2.5 Como testar a Fila de Espera Distribuída entre múltiplos dispositivos?
**Objetivo:** Validar a política de exclusão mútua e avanço automático de fila.

1. Abra uma janela normal do navegador e uma janela anônima (simulando dois smartphones de pais/alunos diferentes).
2. Na Janela 1: Preencha o nome *"Lucas"* e clique em **Simular Entrada**.
   - Lucas entra diretamente na Sala 1. O botão exibe *"Paciente em Atendimento"*.
3. Na Janela 2: Preencha o nome *"Mariana"* e clique em **Entrar na Fila de Espera**.
   - A sala já está ocupada. Mariana é colocada na Fila de Espera.
   - O botão na Janela 2 exibe *"Aguarde sua vez (Posição 1)"*.
4. Na Janela 1: Desmarque a presença ou simule a saída do paciente.
5. **Transição Automática:**
   - O Controlador Líder detecta a liberação da sala e automaticamente remove Mariana do topo da fila, admitindo-a na Sala 1.
   - A iluminação e a playlist se configuram instantaneamente com as preferências da Mariana!

---

## 📖 QUADRANTE 3: Reference (Referência Técnica do Projeto)

### 3.1 Topologia de Rede e Portas do Sistema

| Porta | Protocolo | Serviço | Descrição |
| :---: | :---: | :--- | :--- |
| **1883** | MQTT (TCP) | Eclipse Mosquitto | Barramento central Publish/Subscribe de sensores e atuadores IoT. |
| **27017** | MongoDB | Instância `mongo1` | Banco de dados exclusivo do Controlador 1 (Líder). Coleção `estados_sala`. |
| **27018** | MongoDB | Instância `mongo2` | Banco de dados exclusivo do Controlador 2 (Réplica Honesta). |
| **27019** | MongoDB | Instância `mongo3` | Banco de dados exclusivo do Controlador 3 (Réplica Bizantina). |
| **3000** | HTTP / WS | Next.js Frontend | Servidor Web de aplicação, hospedando Dashboard Clínico e Simulador. |
| **3001** | gRPC (HTTP/2) | Controlador 1 (Líder) | Interface RPC externa (`MiddlewareClinico`) e interna (`ConsensoInterno`). |
| **3002** | gRPC (HTTP/2) | Controlador 2 (Honesto) | Interface RPC redundante para failover e votação honesta de consenso. |
| **3003** | gRPC (HTTP/2) | Controlador 3 (Bizantino) | Interface RPC com injeção de falhas e testes de divergência bizantina. |

---

### 3.2 Catálogo Completo de Tópicos MQTT

| Tópico | Papel | Payload JSON de Exemplo | Descrição |
| :--- | :---: | :--- | :--- |
| `clinica/sala1/ruido` | Sensor $\rightarrow$ Ctrl | `{"db": 68, "timestamp": "..."}` | Telemetria acústica enviada pelo microfone da sala ou simulador mobile. |
| `clinica/sala1/bpm` | Sensor $\rightarrow$ Ctrl | `{"bpm": 84, "timestamp": "..."}` | Frequência cardíaca captada pela pulseira inteligente da criança. |
| `clinica/sala1/porta` | Sensor $\rightarrow$ Ctrl | `{"presenca": true, "nome": "Arthur"}` | Sensor de barreira óptica/RFID na porta da sala. |
| `clinica/recepcao/checkin` | App $\rightarrow$ Ctrl | `{"acao": "entrar_fila", "nome": "Leo", "cor": "Azul", "musica": "Rock"}` | Check-in mobile realizado pelos pais na recepção da clínica. |
| `clinica/sala1/comando/luz` | Ctrl $\rightarrow$ Atuador | `{"cor": "Azul / Calmante", "origem": "controlador-1"}` | Ordem distribuída para ajuste de tonalidade e intensidade das lâmpadas RGB. |
| `clinica/sala1/comando/som` | Ctrl $\rightarrow$ Atuador | `{"som": "Playlist do Paciente (Rock)", "origem": "controlador-1"}` | Ordem para reprodução no Smart Speaker da sala. |
| `clinica/sala1/comando/display`| Ctrl $\rightarrow$ Atuador | `{"mensagem": "> Em Atendimento (Arthur)", "origem": "controlador-1"}` | Mensagem projetada na tela de LCD situada do lado de fora da porta da sala. |

---

### 3.3 Estrutura do Contrato gRPC (`proto/diverterapia.proto`)

O contrato unificado do sistema define dois serviços principais:

#### 1. Serviço `MiddlewareClinico` (Acesso Externo / Next.js):
- `rpc ObterStatus (Empty) returns (EstadoSalaResponse);`  
  *Lê o estado consolidado da sala persistido no banco de dados daquele controlador.*
- `rpc AtivarModoCalmaManual (OrigemRequest) returns (SucessoResponse);`  
  *Aciona o Protocolo de Regulação Sensorial com prioridade manual de 15 segundos.*
- `rpc InvocarMetodo (InvocarMetodoRequest) returns (SucessoResponse);`  
  *Invocação de métodos remotos parametrizados (ex: `configurarAtuadores`).*
- `rpc ToggleBizantino (Empty) returns (SucessoResponse);`  
  *Ativa ou desativa a injeção deliberada de dados falsificados no Controlador 3.*

#### 2. Serviço `ConsensoInterno` (Comunicação Intra-Middleware):
- `rpc VotarEstado (VotoRequest) returns (VotoResponse);`  
  *Chamado pelo Líder aos nós 2 e 3 para coletar votos sobre o estado candidato antes de gravar.*
- `rpc EfetivarEstado (EstadoSalaRequest) returns (SucessoResponse);`  
  *Chamado pelo Líder após Quorum 2x1 para ordenar que as réplicas gravem o estado em seus bancos.*

---

### 3.4 Modelagem de Dados no MongoDB (Coleção `estados_sala`)

Cada controlador grava na coleção `estados_sala` de sua respectiva instância do MongoDB com o seguinte Schema:

```typescript
// Schema estruturado do documento singleton da Sala 1 no MongoDB
{
  salaId: "sala-1",                  // String (chave única do documento)
  ruidoDb: 68,                       // Number (nível acústico em decibéis)
  bpm: 82,                           // Number (frequência cardíaca)
  presenca: true,                    // Boolean (se há paciente na sala)
  tagId: "Arthur",                   // String (nome do paciente atual)
  musicaFavorita: "Rock",            // String (gênero musical favorito)
  corFavorita: "Azul",               // String (cor de iluminação favorita)
  iluminacao: "Cor Favorita (Azul)", // String (estado atual do atuador de luz)
  smartSpeaker: "Playlist (Rock)",   // String (estado atual do atuador de áudio)
  displayPorta: "> Em Atendimento",  // String (texto exibido no visor externo)
  modoCalmaAtivo: false,             // Boolean (flag de protocolo de calma)
  overrideManualAte: 1731870000000,  // Number (timestamp da trava manual de 15s)
  filaEspera: [                      // Array de pacientes aguardando vaga
    {
      nome: "Mariana",               // String
      musica: "Pop",                 // String
      cor: "Verde",                  // String
      horario: "15:30:10"            // String
    }
  ],
  ultimaAtualizacao: "2026-11-17T18:30:00.000Z", // String ISO
  historico: [                       // Array dos últimos 15 eventos de auditoria
    {
      horario: "2026-11-17T18:29:55.000Z",
      tipo: "TELEMETRIA",
      descricao: "Ruído do Simulador: 68 dB [Consenso Quorum 2x1 Aprovado]"
    }
  ]
}
```

---

### 3.5 Padronização das 4 Combinações Clínicas

| Modo Clínico | Nome no Botão | Card Iluminação | Card Smart Speaker | Card Visor da Porta |
| :--- | :--- | :--- | :--- | :--- |
| **1. Regulação Sensorial** | *Regulação Sensorial* | **Azul / Calmante** | **Frequência Calmante (Ruído Branco)** | `> Regulação em Curso (Não Entre)` |
| **2. Integração Lúdica** | *Integração Lúdica* | **Verde / Viva** | **Sons da Natureza** | `> Sessão Lúdica em Andamento` |
| **3. Foco Dirigido** | *Foco Dirigido* | **Branca / Alto Contraste** | **Isolamento Acústico (Mudo)** | `> Sessão de Foco (Silêncio)` |
| **4. Perfil do Paciente** | *Perfil do Paciente* | **Cor Favorita (Dinâmica)** | **Playlist do Paciente (Dinâmica)** | `> Em Atendimento (Nome da Criança)` |

---

## 💡 QUADRANTE 4: Explanation (Explicação Teórica e Arquitetural)

### 4.1 Por que o Consenso é feito no Backend com Controlador Líder?
Nos modelos ingênuos de arquitetura distribuída, o cliente (navegador/frontend) consulta os nós e decide qual valor exibir. Isso cria uma falha grave: **inconsistência de banco de dados**. Se cada controlador gravasse no seu banco antes de consultar os outros, teríamos bancos de dados com informações divergentes, e um controlador malicioso gravaria dados falsificados permanentemente.

No Diverterapia, aplicamos a regra de ouro dos Sistemas Distribuídos profissionais:
$$\text{Validação por Quorum} \longrightarrow \text{Gravação no Banco (Commit)} \longrightarrow \text{Atuação Física}$$

1. **O Controlador 1 atua como Líder (Coordenador de Transação):**
   - Ao receber qualquer evento (MQTT ou gRPC), ele gera um **Estado Candidato** em memória.
   - Ele **não grava** no MongoDB imediatamente.
2. **Fase de Votação (Consenso 2x1):**
   - O Líder consulta os Controladores 2 e 3 via RPC `VotarEstado`.
   - O Controlador 2 (Honesto) ouve os mesmos dados do MQTT e concorda com o Líder ($+1$ voto).
   - O Controlador 3 (Bizantino) tenta trapacear, enviando ruído falso de 999 dB e BPM 250.
   - O algoritmo comparador do Líder detecta a discrepância absurda e **descarta o voto do nó 3**.
   - Com 2 votos a favor em 3 possíveis ($\frac{2}{3}$ de maioria), o **Quorum 2x1 está formado**.
3. **Fase de Efetivação (Commit Atômico nas Réplicas):**
   - O Líder grava no seu próprio MongoDB 1.
   - Dispara comandos físicos para os atuadores via MQTT.
   - Envia a ordem `EfetivarEstado` via gRPC para que as réplicas 2 e 3 gravem o estado validado em seus respectivos bancos (`MongoDB 2` e `MongoDB 3`).

---

### 4.2 O Problema dos Generais Bizantinos no Contexto da Clínica
Uma **Falha Bizantina** ocorre quando um nó do sistema distribuído não apenas falha silenciosamente (crash), mas age de forma maliciosa ou corrompida, transmitindo informações contraditórias ou falsificadas para confundir o cluster.

No Diverterapia, simulamos esse cenário acadêmico através do **Controlador 3**:
- Se a clínica dependesse de uma média simples entre os nós:
  $$\frac{60\text{ dB (Nó 1)} + 60\text{ dB (Nó 2)} + 999\text{ dB (Nó 3)}}{3} \approx 373\text{ dB (Valor Destrutivo!)}$$
- Graças ao algoritmo de **Quorum e Comparação por Assinatura**, o Líder não faz média: ele busca **congruência semântica**. Como o valor 999 dB do Nó 3 não encontra par em nenhuma outra réplica, ele é rotulado como anomalia/bizantino e expurgado da votação.
- Pelo teorema de tolerância a falhas bizantinas com assinaturas e canais seguros, para tolerar $f=1$ nó bizantino, $2f + 1 = 3$ nós são suficientes para garantir a continuidade operacional com maioria simples ($2 \times 1$).

---

### 4.3 A Tríade de Protocolos: Por que MQTT, gRPC e HTTP juntos?

| Protocolo | Onde é usado no Projeto? | Por que foi escolhido? (Justificativa Técnica) |
| :--- | :--- | :--- |
| **MQTT** | Barramento IoT (Sensores e Atuadores) | **Leveza e Desacoplamento:** O padrão Publish/Subscribe evita que sensores minúsculos precisem conhecer o endereço IP dos servidores. O broker gerencia distribuição de mensagens assíncronas com baixo consumo de banda e bateria. |
| **gRPC** | Comunicação Líder-Réplica e Gateway | **Alto Desempenho e Tipagem Estrita:** Trafega binário sobre **HTTP/2 multiplexado**, com latência desprezível em relação ao JSON. O contrato Protobuf impede erros de tipo entre linguagens e servidores distribuídos. |
| **HTTP/REST** | Navegador Web e Celulares | **Universalidade e Compatibilidade:** Navegadores web e smartphones não falam gRPC puro diretamente de forma trivial. O Next.js atua como Gateway de borda, traduzindo requisições HTTP do browser para chamadas gRPC de alta velocidade no backend. |

---

### 4.4 Tolerância a Falhas e Ciclo de Recuperação (Crash-Recovery)
O sistema foi desenhado para ser resiliente a reinicializações e falhas parciais:
- **Se o Controlador 1 cair:** O Next.js detecta `ECONNREFUSED` na porta 3001 e redireciona automaticamente suas requisições gRPC para o Controlador 2 (porta 3002), mantendo o painel e os atuadores responsivos.
- **Quando o nó defeituoso reinicia:** Ele lê imediatamente a coleção `estados_sala` de sua instância local do MongoDB (`carregarEstadoDoMongoDB`), recupera o histórico dos últimos eventos e reconecta ao broker MQTT, retornando ao cluster sem perda de estado.
- **Tolerância a desconexão de banco:** Se um MongoDB demorar para iniciar, os controladores mantêm o estado em memória RAM e tentam a reconexão automática, evitando que a sala física fique inoperante durante transientes de rede.

---

*Documentação elaborada sob o framework Diátaxis para o Trabalho Prático de Sistemas Distribuídos — Middleware Diverterapia.*
