# Manual Técnico, Didático e Arquitetural — Middleware IoT Diverterapia

> **Sistema Distribuído de Regulação Sensorial Pediátrica com Tolerância a Falhas por Parada (Crash/Failover) e Falhas Bizantinas (Quorum 2x1)**  
> *Documentação estruturada segundo o framework internacional **Diátaxis** (Visão Geral, Tutorial, How-To Guides, Reference e Explanation)*

---

## 📌 PARTE 0: Visão Geral, Contexto Clínico e Raio-X do Repositório

### 0.1 O Problema Clínico e a Solução Distribuída

O **Diverterapia** é uma plataforma clínica e terapêutica projetada para **Salas Pediátricas Inteligentes** voltadas ao acolhimento de crianças neurodivergentes — especialmente com **Transtorno do Espectro Autista (TEA)**, **Transtorno do Déficit de Atenção com Hiperatividade (TDAH)** e hipersensibilidade sensorial.

Em clínicas e hospitais pediátricos, variações bruscas de estímulos ambientais (como ruídos elevados no corredor, choro intenso, iluminação inadequada ou entrada abrupta de pessoas na sala) podem desencadear crises sensoriais agudas (*meltdowns* ou *shutdowns*), acompanhadas de taquicardia e desregulação emocional.

Para resolver esse problema com **segurança clínica e alta disponibilidade**, o Diverterapia implementa um **Middleware IoT Distribuído** que opera em tempo real sobre quatro pilares:

1. **Percepção Contínua (Telemetria IoT via MQTT):** Monitora constantemente o nível de ruído acústico da sala (em decibéis — `dB`), a frequência cardíaca da criança via pulseira inteligente (em batimentos por minuto — `BPM`) e a presença física/identificação do paciente via sensor de porta/RFID e check-in mobile.
2. **Atuação Ambiental Automatizada (Atuadores via MQTT):** Ajusta instantaneamente três dispositivos físicos na sala:
   - **Iluminação RGB:** Alterna entre luz azul calmante, verde lúdica, branca de alto contraste ou a cor favorita da criança.
   - **Smart Speaker:** Reproduz frequência calmante (ruído branco), sons da natureza, isolamento acústico ou a playlist musical favorita do paciente.
   - **Display da Porta (Visor LCD Externo):** Orienta a equipe médica externa com avisos em tempo real (ex.: `> Regulação em Curso (Não Entre)` ou `> Em Atendimento (Arthur)`).
3. **Consenso Distribuído e Tolerância a Falhas Bizantinas (Quorum 2x1 via gRPC):** Nenhum comando ou leitura altera os bancos de dados ou os atuadores sem antes passar por uma votação distribuída entre **3 Controladores gRPC independentes**. Se o **Controlador 3** sofrer um ataque cibernético ou falha de hardware e tentar injetar valores falsos (`999 dB` e `250 BPM`), o algoritmo de Quorum detecta a anomalia e descarta o voto malicioso antes da gravação e da atuação física.
4. **Replicação de Estado e Failover com Líder Interino (3 Instâncias MongoDB + Heartbeat gRPC):** Cada controlador possui seu próprio banco de dados MongoDB isolado (`mongo1`, `mongo2`, `mongo3`). Se o **Controlador 1 (Líder Primário)** cair, o **Controlador 2 (Réplica Honesta)** detecta a queda em até `1,5 segundo`, assume automaticamente o papel de **Líder Interino** e mantém toda a clínica funcionando — inclusive a fila de espera, os atuadores MQTT e o Dashboard Web. Quando o Controlador 1 retorna, ele executa recuperação de estado (*Crash-Recovery* + *Catch-up* via gRPC) e reassume a liderança sem perda de dados.

---

### 0.2 Diagrama Arquitetural Completo (Ponta a Ponta)

O diagrama abaixo representa o fluxo real de dados e chamadas remotas entre todas as camadas do projeto:

```mermaid
flowchart TD
    subgraph SENSORIAMENTO["1. Camada de Percepção (Publishers MQTT Puros)"]
        S_RUIDO["Sensor de Ruído CLI\n(sensores/sensorRuido.ts)\nTópico: clinica/sala1/ruido"]
        S_BPM["Sensor de BPM CLI\n(sensores/sensorBPM.ts)\nTópico: clinica/sala1/bpm"]
        S_PRES["Sensor de Presença CLI\n(sensores/sensorPresenca.ts)\nTópico: clinica/sala1/porta"]
        SIM_MOB["Simulador Mobile / Recepção\n(/simulador -> POST /api/mqtt/publish)\nTópico: clinica/recepcao/checkin"]
    end

    subgraph BROKER["2. Barramento Publish/Subscribe (Docker)"]
        MOSQ["Eclipse Mosquitto Broker MQTT\nContainer: mqtt-broker | Porta: 1883"]
    end

    subgraph MIDDLEWARE["3. Middleware Distribuído (Cluster gRPC Puro)"]
        CTRL1["Controlador 1 (LÍDER PRIMÁRIO)\ncontroladores/controlador1.ts\ngRPC Porta: 3001"]
        CTRL2["Controlador 2 (RÉPLICA HONESTA / LÍDER INTERINO)\ncontroladores/controlador2.ts\ngRPC Porta: 3002"]
        CTRL3["Controlador 3 (RÉPLICA BIZANTINA TOGGLEÁVEL)\ncontroladores/controlador3.ts\ngRPC Porta: 3003"]
    end

    subgraph BANCOS["4. Camada de Persistência Isolada (Docker)"]
        DB1[("MongoDB 1\nContainer: mongo1\nPorta: 27017")]
        DB2[("MongoDB 2\nContainer: mongo2\nPorta: 27018")]
        DB3[("MongoDB 3\nContainer: mongo3\nPorta: 27019")]
    end

    subgraph ATUADORES["5. Camada de Atuação Física (Subscribers MQTT Puros)"]
        A_LUZ["Atuador Iluminação RGB\n(atuadores/iluminacao.ts)\nTópico: clinica/sala1/comando/luz"]
        A_SOM["Atuador Smart Speaker\n(atuadores/smartSpeaker.ts)\nTópico: clinica/sala1/comando/som"]
        A_DISP["Atuador Display da Porta\n(atuadores/displayPorta.ts)\nTópico: clinica/sala1/comando/display"]
    end

    subgraph CLIENTE["6. Camada de Aplicação e Gateway BFF (Next.js 14 - Porta 3000)"]
        GATEWAY["API Gateway / Cliente gRPC\n(src/lib/grpcClient.ts)\nRotas: /api/status | /api/controlador"]
        DASHBOARD["Dashboard Clínico Multi-Cliente\n(Cliente 1: Médico | Cliente 2: Enfermagem)"]
        MOB_VIEW["Interface Mobile do Paciente\n(http://localhost:3000/simulador)"]
    end

    %% Publicações IoT
    S_RUIDO -->|Publish JSON dB| MOSQ
    S_BPM -->|Publish JSON BPM| MOSQ
    S_PRES -->|Publish JSON Presença| MOSQ
    SIM_MOB -->|Publish Check-in e Telemetria| MOSQ

    %% Assinaturas MQTT pelos 3 Controladores
    MOSQ -->|Subscribe Telemetria| CTRL1
    MOSQ -->|Subscribe Telemetria| CTRL2
    MOSQ -->|Subscribe Telemetria| CTRL3

    %% Consenso Interno e Replicação via gRPC
    CTRL1 <-->|1. gRPC VotarEstado (Quorum 2x1 ou 3x3)| CTRL2
    CTRL1 <-->|1. gRPC VotarEstado (Filtra Falha Bizantina)| CTRL3
    CTRL1 -->|2. gRPC EfetivarEstado (Commit Validado)| CTRL2
    CTRL1 -->|2. gRPC EfetivarEstado (Sobrescreve Nó 3)| CTRL3

    %% Gravação nos Bancos Independentes
    CTRL1 -->|3. Upsert estados_sala| DB1
    CTRL2 -->|3. Upsert estados_sala| DB2
    CTRL3 -->|3. Upsert estados_sala| DB3

    %% Publicação de Comandos aos Atuadores após Consenso
    CTRL1 -->|4. Publish Comandos Validados| MOSQ
    CTRL2 -.->|Failover: Votar/EfetivarEstado se C1 cair| CTRL3
    CTRL2 -.->|Failover: Publish Comandos se C1 cair| MOSQ
    MOSQ -->|Subscribe Luz| A_LUZ
    MOSQ -->|Subscribe Som| A_SOM
    MOSQ -->|Subscribe Display| A_DISP

    %% Comunicação Cliente <-> Middleware
    GATEWAY <-->|gRPC ObterStatus / InvocarMetodo| CTRL1
    GATEWAY -.->|Failover Automático se 3001 cair| CTRL2
    GATEWAY <-->|Health-Check e ToggleBizantino| CTRL3
    DASHBOARD <-->|HTTP Polling 500ms / POST| GATEWAY
    MOB_VIEW <-->|HTTP Polling 1000ms / POST| GATEWAY
```

---

### 0.3 Anatomia Completa do Projeto (Para que serve cada pasta e cada arquivo?)

Esta seção é um guia didático completo da árvore de diretórios do repositório `trabalho-pratico-sd/`. Aqui você entende exatamente **o que cada pasta guarda**, **qual o papel de cada arquivo** e **como eles conversam entre si**.

```text
trabalho-pratico-sd/
├── docker-compose.yml                # Infraestrutura containerizada (1 Mosquitto + 3 MongoDBs)
├── package.json                      # Dependências do backend e scripts npm de execução
├── tsconfig.json                     # Configuração do compilador TypeScript do backend
├── iniciar-tudo.ps1                  # Script PowerShell que sobe toda a arquitetura em 1 comando
├── iniciar-tudo.bat                  # Atalho Batch para Windows que aciona o iniciar-tudo.ps1
├── README.md                         # Cartão de visita e resumo rápido do repositório
├── proto/                            # [PASTA] Contratos formais de comunicação RPC
│   └── diverterapia.proto            # Contrato Protobuf v3 (Fonte Única de Verdade do gRPC)
├── controladores/                    # [PASTA] Nós do Middleware Distribuído e Regras de Negócio
│   ├── regrasClinicas.ts             # Motor determinístico de regras clínicas e comparação de votos
│   ├── persistenciaMongo.ts          # Módulo unificado Mongoose, reconexão automática e .env
│   ├── controlador1.ts               # Controlador 1 (Líder Primário - gRPC :3001 -> MongoDB :27017)
│   ├── controlador2.ts               # Controlador 2 (Réplica Honesta e Líder Interino - gRPC :3002 -> MongoDB :27018)
│   └── controlador3.ts               # Controlador 3 (Réplica Bizantina Toggleável - gRPC :3003 -> MongoDB :27019)
├── sensores/                         # [PASTA] Dispositivos IoT de Entrada (Publishers MQTT Puros)
│   ├── sensorRuido.ts                # Sensor de ruído acústico (dB) via CLI interativo ou modo --auto
│   ├── sensorBPM.ts                  # Sensor de frequência cardíaca (BPM) via CLI interativo ou modo --auto
│   └── sensorPresenca.ts             # Sensor de porta/RFID (entrada/saída) via CLI interativo ou modo --auto
├── atuadores/                        # [PASTA] Dispositivos IoT de Saída (Subscribers MQTT Puros)
│   ├── iluminacao.ts                 # Atuador físico das lâmpadas inteligentes RGB da sala
│   ├── smartSpeaker.ts               # Atuador físico do sistema de som ambiente / ruído branco
│   └── displayPorta.ts               # Atuador físico do visor LCD externo na porta da sala
├── cliente-dashboard/                # [PASTA] Aplicação Web Next.js 14 (Dashboard, Simulador e Gateway gRPC)
│   ├── package.json                  # Dependências do frontend Next.js, React, Tailwind e @grpc/grpc-js
│   └── src/
│       ├── lib/
│       │   └── grpcClient.ts         # Cliente gRPC do Gateway BFF com failover automático e sondagem dos 3 nós
│       └── app/
│           ├── page.tsx              # Dashboard Clínico Principal (Médico / Enfermagem, Quorum e Auditoria)
│           ├── simulador/
│           │   └── page.tsx          # Interface Mobile dos Alunos (Check-in na Fila e Sliders de Telemetria)
│           └── api/
│               ├── status/route.ts       # Endpoint GET que consulta o estado validado no cluster gRPC
│               ├── controlador/route.ts  # Endpoint POST que invoca métodos remotos gRPC e ToggleBizantino
│               └── mqtt/publish/route.ts # Endpoint POST que publica mensagens do Simulador Mobile no Mosquitto
└── docs/                             # [PASTA] Documentação Arquitetural e Acadêmica
    ├── DOCUMENTACAO_TECNICA.md       # Este manual completo estruturado em Diátaxis (Markdown)
    └── DOCUMENTACAO_TECNICA.pdf      # Versão diagramada para leitura e impressão (PDF)
```

---

#### 🔍 Explicação Detalhada de Cada Pasta e Arquivo

##### 1. Arquivos da Raiz (Infraestrutura e Orquestração)
* **[docker-compose.yml](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/docker-compose.yml):**
  * **Para que serve:** Define e sobe a infraestrutura base em containers Docker isolados.
  * **O que contém:** 4 serviços independentes:
    1. `mqtt-broker`: Imagem oficial `eclipse-mosquitto:2` exposta na porta `1883`, configurada para aceitar conexões locais dos sensores, atuadores e controladores.
    2. `mongo1`: Primeira instância do banco de dados MongoDB (`mongo:latest`), mapeada na porta `27017` do host com volume persistente `mongo1_data` exclusivo para o Controlador 1.
    3. `mongo2`: Segunda instância do MongoDB (`mongo:latest`), mapeada na porta `27018` com volume `mongo2_data` exclusivo para o Controlador 2.
    4. `mongo3`: Terceira instância do MongoDB (`mongo:latest`), mapeada na porta `27019` com volume `mongo3_data` exclusivo para o Controlador 3.
* **[package.json](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/package.json):**
  * **Para que serve:** Gerencia as bibliotecas do backend (`mqtt`, `mongoose`, `@grpc/grpc-js`, `@grpc/proto-loader`, `concurrently`, `tsx`) e disponibiliza os atalhos de execução (`npm run ctrl1`, `npm run sensor:ruido`, `npm run atuador:luz`, `npm run start:all`).
* **[iniciar-tudo.ps1](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/iniciar-tudo.ps1) e [iniciar-tudo.bat](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/iniciar-tudo.bat):**
  * **Para que servem:** Scripts de automação para Windows que verificam se o Docker está rodando, sobem os 4 containers (`docker compose up -d`), instalam dependências se necessário e iniciam todos os microsserviços e o frontend simultaneamente.

---

##### 2. Pasta `proto/` (Contrato Formal de Interface RPC)
* **[proto/diverterapia.proto](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/proto/diverterapia.proto):**
  * **Para que serve:** É a **Fonte Única de Verdade** (*Single Source of Truth*) para toda a comunicação gRPC do sistema. Tanto os 3 controladores no backend quanto o Gateway Next.js no frontend carregam exatamente este mesmo arquivo.
  * **Como funciona:** Escrito na sintaxe `proto3`, ele evita erros de tipagem e divide as chamadas remotas em dois serviços distintos:
    * `service MiddlewareClinico`: Métodos chamados pelo cliente externo/Next.js (`ObterStatus`, `AtivarModoCalmaManual`, `InvocarMetodo`, `ToggleBizantino`).
    * `service ConsensoInterno`: Métodos chamados exclusivamente entre os próprios controladores durante o protocolo de consenso distribuído (`VotarEstado` para fase de votação/prepare e `EfetivarEstado` para fase de gravação/commit).

---

##### 3. Pasta `controladores/` (O Coração do Middleware Distribuído)
Esta é a pasta mais importante da arquitetura de Sistemas Distribuídos. Ela contém os 3 servidores gRPC e o motor compartilhado de regras clínicas.

* **[controladores/regrasClinicas.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/controladores/regrasClinicas.ts):**
  * **Para que serve:** Centraliza toda a lógica determinística de decisão clínica, manipulação da fila de espera, clonagem profunda de estado (`clonarEstado`) e verificação matemática de congruência entre votos (`compararEstados`).
  * **Por que ele existe:** Em um sistema distribuído com replicação de máquina de estados (*State Machine Replication*), todas as réplicas honestas precisam aplicar **exatamente a mesma função de transição** ao receberem uma mensagem MQTT para chegarem ao mesmo resultado. Ao compartilhar `regrasClinicas.ts`, garantimos que o Controlador 1 e o Controlador 2 calculem estados idênticos para o mesmo estímulo.
  * **O que ele faz na prática:**
    * Define as **4 Combinações Clínicas Oficiais** (`COMB_1_REGULACAO`, `COMB_2_LUDICA`, `COMB_3_FOCO`, `COMB_4_PERFIL`).
    * Avalia a telemetria (`aplicarRegrasClinicas`): se $\text{Ruído} > 85\text{ dB}$ ou $\text{BPM} > 120$, aciona imediatamente o **Protocolo de Regulação Sensorial** (Luz Azul Calmante + Ruído Branco + Porta `> Regulação em Curso (Não Entre)`), a menos que haja um *Override Manual* ativo (trava temporal de 15 segundos acionada por um médico ou enfermeiro).
    * Gerencia o check-in, a entrada direta na sala livre e o avanço automático do primeiro paciente da fila (`filaEspera.shift()`) assim que o paciente atual encerra o atendimento.
    * Compara os campos essenciais do estado do Líder com o voto das réplicas (`compararEstados`): valida `ruidoDb`, `bpm`, `presenca`, `tagId`, `iluminacao`, `smartSpeaker`, `displayPorta`, `modoCalmaAtivo` e a estrutura completa de `filaEspera`.

* **[controladores/persistenciaMongo.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/controladores/persistenciaMongo.ts):**
  * **Para que serve:** Unifica o *schema* e o `EstadoSalaModel` do **Mongoose (`^8.8.1`)**, evitando duplicação entre os 3 controladores.
  * **Recursos implementados:**
    * Leitura automática de `.env` na raiz (`MONGO_URI_1`, `MONGO_URI_2`, `MONGO_URI_3`) com *fallback* para `mongodb://127.0.0.1:27017..27019/diverterapia` e mascaramento de credenciais em logs.
    * Retorno explícito do status real no campo `armazenamentoId` (`MongoDB X [CONECTADO]` vs. `MongoDB X [OFFLINE - RAM]`) e retorno booleano nas gravações para evitar confirmações falsas quando o banco está offline.
    * Reconexão automática em segundo plano a cada `10s`, sincronizando automaticamente memória e banco assim que a instância MongoDB voltar.
    * Comparação determinística `deveAbsorverEstadoRemoto()` para o *catch-up* das réplicas sem *race condition* durante o *polling* de `ObterStatus`.

* **[controladores/controlador1.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/controladores/controlador1.ts):**
  * **Para que serve:** É o **Controlador 1 (Líder Primário / Coordenador do Cluster)**. Roda um servidor gRPC puro na porta `3001` e persiste seus dados exclusivamente no `mongo1` (porta `27017`).
  * **Como funciona seu ciclo interno:**
    1. **Inicialização (*Crash-Recovery* + *Catch-up*):** Ao ligar, conecta ao MongoDB `27017` e carrega o último estado salvo (`carregarEstadoDoMongoDB`). Em seguida, executa `sincronizarCatchUpComReplica2()`: consulta o Controlador 2 via gRPC (`:3002`) para verificar se ocorreram novos atendimentos ou comandos enquanto o Controlador 1 esteve desligado. Se o estado do C2 for mais recente, o C1 absorve esse estado e atualiza o MongoDB 1 antes de começar a operar.
    2. **Fila Sequencial (*Anti-Race Condition*):** Todas as mensagens MQTT recebidas e chamadas gRPC (`AtivarModoCalmaManual`, `InvocarMetodo`) entram em uma fila de promessas (`enfileirarOperacao`). Isso impede que duas mensagens simultâneas (ex.: slider de ruído e slider de BPM movidos juntos) atropelem a memória durante uma votação.
    3. **Orquestração do Quorum 2x1 (`executarConsensoQuorum`):** Para cada evento, o Líder gera um `estadoCandidato` em memória RAM (sem gravar no banco ainda) e chama `VotarEstado` via gRPC nos Controladores 2 (`:3002`) e 3 (`:3003`).
    4. **Commit Distribuído e Atuação Física:** Ao obter maioria ($\ge 2$ votos íntegros de 3 possíveis), o Líder registra o evento no histórico, grava no `mongo1` (`27017`), ordena que as réplicas 2 e 3 gravem exatamente o mesmo estado validado via gRPC `EfetivarEstado` (corrigindo inclusive o banco do nó 3 bizantino!) e, somente após o commit, publica as ordens físicas nos tópicos MQTT dos 3 atuadores.

* **[controladores/controlador2.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/controladores/controlador2.ts):**
  * **Para que serve:** É o **Controlador 2 (Réplica Honesta e Líder Interino de Failover)**. Roda um servidor gRPC puro na porta `3002` e conecta exclusivamente ao `mongo2` (porta `27018`).
  * **Como funciona sua dupla personalidade (Réplica $\leftrightarrow$ Líder Interino):**
    1. **Em operação normal (quando o Controlador 1 está online):** O C2 escuta os mesmos tópicos MQTT de telemetria, calcula seu estado local honestamente usando `regrasClinicas.ts` e responde às chamadas `VotarEstado` do Líder 1 com integridade (`Voto Íntegro`). Quando o Líder 1 aprova o Quorum e chama `EfetivarEstado`, o C2 grava o estado oficial no `mongo2` (`27018`).
    2. **Detector de Falhas (*Heartbeat* a cada 1,5s):** Um laço contínuo (`iniciarMonitoramentoLider`) sonda o método `ObterStatus` do Controlador 1 (`:3001`) com timeout de `600ms`.
    3. **Promoção a Líder Interino (*Failover Automático*):** Se o Controlador 1 não responder, o C2 seta `liderPrimarioOnline = false` e exibe no terminal: `👑 [controlador-2] Controlador 1 offline! Assumindo liderança interina (Failover)`. A partir desse instante, qualquer telemetria MQTT ou comando manual enviado pelo Dashboard é coordenado pelo próprio C2: ele coleta o voto do C3, aprova o Quorum, grava no `mongo2`, replica para o `mongo3` via `EfetivarEstado` e **publica diretamente nos 3 atuadores MQTT**.
    4. **Devolução Pacífica de Liderança:** Assim que o *heartbeat* detecta que o Controlador 1 voltou a responder na porta `3001`, o C2 desativa o modo interino (`liderPrimarioOnline = true`) e retorna automaticamente ao papel de Réplica Honesta.

* **[controladores/controlador3.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/controladores/controlador3.ts):**
  * **Para que serve:** É o **Controlador 3 (Réplica Bizantina Toggleável)**. Roda um servidor gRPC puro na porta `3003` e conecta exclusivamente ao `mongo3` (porta `27019`).
  * **Como funciona a simulação de Falha Bizantina:**
    * Possui uma variável booleana de estado `simularFalhaBizantina` (que inicia como `true` por padrão para demonstração imediata).
    * **Quando `simularFalhaBizantina === true` (Modo Traidor/Corrompido):** Sempre que o Líder pede seu voto via `VotarEstado` (ou quando o Gateway sonda `ObterStatus`), o Controlador 3 ignora a leitura real da sala e devolve um estado falsificado com **`ruidoDb: 999`**, **`bpm: 250`**, **`iluminacao: "ALERTA_BIZANTINO_FALSO"`**, **`smartSpeaker: "RUIDO_CORROMPIDO"`** e **`modoCalmaAtivo: true`**. Apesar de tentar sabotar a votação, quando o Líder alcança Quorum 2x1 (Líder + C2) e envia a ordem `EfetivarEstado`, o Controlador 3 acata o commit do estado validado em seu banco `mongo3` (`27019`), mantendo a consistência do armazenamento replicado.
    * **Quando `simularFalhaBizantina === false` (Modo Honesto):** Ao clicar no botão de *Toggle Bizantino* no Dashboard (que invoca a RPC `ToggleBizantino` na porta `3003`), o Controlador 3 passa a calcular e retornar os valores reais e íntegros da sala, fazendo o cluster operar em **Consenso Unânime (3/3 votos)**.

---

##### 4. Pasta `sensores/` (Camada de Percepção IoT — Publishers MQTT Puros)
Seguindo estritamente o modelo arquitetural Publish/Subscribe da especificação, os sensores **apenas publicam** dados nos tópicos do broker Mosquitto (`mqtt://127.0.0.1:1883`) e não conhecem os endereços IP ou portas dos controladores.

* **[sensores/sensorRuido.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/sensores/sensorRuido.ts):**
  * **Para que serve:** Simula o microfone decibelímetro instalado no teto da Sala 1. Publica payloads JSON `{"db": <valor>, "timestamp": "..."}` no tópico `clinica/sala1/ruido`.
  * **Modos de operação:**
    * **Modo Interativo CLI (Padrão):** Abre um prompt no terminal onde você pode digitar qualquer valor entre `30` e `130` (ex.: digitar `95` + Enter para disparar uma crise acústica) ou `auto` para ligar/desligar o gerador automático.
    * **Modo Automático (`--auto`):** Se iniciado com `npx tsx sensores/sensorRuido.ts --auto`, publica leituras periódicas a cada 5 segundos (com 80% de chance de ruído normal entre 40–70 dB e 20% de chance de pico agudo entre 86–105 dB).
* **[sensores/sensorBPM.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/sensores/sensorBPM.ts):**
  * **Para que serve:** Simula a pulseira biométrica vestível (*wearable*) no pulso da criança. Publica `{"bpm": <valor>, "timestamp": "..."}` no tópico `clinica/sala1/bpm`.
  * **Modos de operação:** Aceita digitação direta de batimentos entre `40` e `220` no terminal CLI (ex.: digitar `135` + Enter para simular taquicardia aguda) ou flag `--auto` (leituras a cada 4 segundos).
* **[sensores/sensorPresenca.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/sensores/sensorPresenca.ts):**
  * **Para que serve:** Simula o leitor RFID / sensor óptico de barreira na porta da Sala 1. Publica `{"presenca": true/false, "nome": "...", "timestamp": "..."}` no tópico `clinica/sala1/porta`.
  * **Modos de operação:** No terminal CLI, aceita comandos como `entrar Arthur` (simula a criança passando pela porta com sua tag) ou `sair` (simula a liberação da sala, acionando o avanço automático da fila de espera), além do modo `--auto`.

---

##### 5. Pasta `atuadores/` (Camada de Atuação Física — Subscribers MQTT Puros)
Os atuadores representam o hardware físico da sala terapêutica. Eles **apenas assinam** (*subscribe*) os tópicos de comando no broker Mosquitto (`mqtt://127.0.0.1:1883`) e reagem às ordens publicadas pelo Líder após a validação do Quorum.

* **[atuadores/iluminacao.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/atuadores/iluminacao.ts):**
  * **Para que serve:** Assina o tópico `clinica/sala1/comando/luz`. Quando recebe um JSON `{"cor": "...", "origem": "..."}`, ajusta os painéis de LED RGB da sala e exibe um quadro visual formatado no terminal indicando a nova tonalidade e qual controlador emitiu a ordem (`controlador-1` ou `controlador-2 (Líder Interino)`).
* **[atuadores/smartSpeaker.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/atuadores/smartSpeaker.ts):**
  * **Para que serve:** Assina o tópico `clinica/sala1/comando/som`. Quando recebe `{"som": "...", "origem": "..."}`, altera a trilha sonora do ambiente (ex.: `Frequência Calmante (Ruído Branco)`, `Sons da Natureza`, `Isolamento Acústico` ou `Playlist do Paciente (Rock)`).
* **[atuadores/displayPorta.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/atuadores/displayPorta.ts):**
  * **Para que serve:** Assina o tópico `clinica/sala1/comando/display`. Quando recebe `{"mensagem": "...", "origem": "..."}`, atualiza o letreiro digital LCD externo da porta para orientar médicos, enfermeiros e acompanhantes.

---

##### 6. Pasta `cliente-dashboard/` (Camada de Aplicação Web e Gateway gRPC)
Como navegadores web não abrem conexões gRPC HTTP/2 binárias puras diretamente sem proxies externos, o servidor Next.js 14 atua como um **BFF (*Backend-For-Frontend*) / API Gateway**, traduzindo as ações da interface gráfica em chamadas gRPC nativas para as portas `3001`, `3002` e `3003`.

* **[cliente-dashboard/src/lib/grpcClient.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/cliente-dashboard/src/lib/grpcClient.ts):**
  * **Para que serve:** É o módulo cliente gRPC do frontend. Carrega dinamicamente `../proto/diverterapia.proto` via `@grpc/proto-loader` e instancia os *stubs* gRPC para `localhost:3001`, `localhost:3002` e `localhost:3003`.
  * **Funções essenciais que ele exporta:**
    * `obterStatusComConsenso()`: Consulta os 3 controladores em paralelo com *deadline* de `800ms` para descobrir quem está online, verifica se o Controlador 3 está em modo bizantino (comparando a assinatura do estado de C3 com a do líder ativo) e retorna o **estado oficial já validado por Quorum no backend** (do Controlador 1, ou do Controlador 2 em caso de *failover*), acompanhado dos metadados reais do cluster (`_meta`).
    * `invocarMetodoComFailover()` e `ativarCalmaComFailover()`: Tentam invocar o método remoto primariamente no Controlador 1 (`:3001`). Se a chamada falhar por queda do nó (`UNAVAILABLE` / `DEADLINE_EXCEEDED`), redirecionam **automaticamente e de forma transparente** para o Controlador 2 (`:3002`), registrando no retorno que houve `failoverAcionado: true` para exibição no Console de Auditoria.
    * `alternarModoBizantinoCtrl3()`: Invoca diretamente a RPC `ToggleBizantino` no Controlador 3 (`:3003`).
* **[cliente-dashboard/src/app/api/status/route.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/cliente-dashboard/src/app/api/status/route.ts):**
  * **Para que serve:** Rota HTTP `GET /api/status` consumida a cada `500ms` pelo Dashboard e a cada `1000ms` pelo Simulador Mobile. Chama `obterStatusComConsenso()` e entrega o JSON completo da sala e a saúde dos 3 nós gRPC.
* **[cliente-dashboard/src/app/api/controlador/route.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/cliente-dashboard/src/app/api/controlador/route.ts):**
  * **Para que serve:** Rota HTTP `POST /api/controlador` que recebe os cliques dos terapeutas no Dashboard (ex.: ativar Regulação Sensorial, Integração Lúdica, Foco Dirigido, Perfil do Paciente ou alternar falha bizantina) e dispara a respectiva RPC no cluster com suporte a múltiplos clientes (`Cliente 1 (Médico)` ou `Cliente 2 (Enfermagem)`).
* **[cliente-dashboard/src/app/api/mqtt/publish/route.ts](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/cliente-dashboard/src/app/api/mqtt/publish/route.ts):**
  * **Para que serve:** Rota HTTP `POST /api/mqtt/publish` usada exclusivamente pela página `/simulador` (celulares dos alunos) para publicar eventos de check-in e sliders de ruído/BPM diretamente no broker Mosquitto (`mqtt://127.0.0.1:1883`).
* **[cliente-dashboard/src/app/page.tsx](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/cliente-dashboard/src/app/page.tsx):**
  * **Para que serve:** Interface visual do **Dashboard Clínico Principal**. Permite alternar a visão entre **Cliente 1 (Médico)** e **Cliente 2 (Enfermagem)**, exibe o banner dinâmico de consenso (*Consenso Unânime 3/3*, *Quorum 2x1 Validado* ou *Failover Ativo no Controlador 2*), mostra cartões em tempo real dos 3 controladores com o badge real de conexão do MongoDB (`MongoDB :2701X conectado` ou `Fallback RAM`), estado dos 3 atuadores, medidores de Ruído/BPM e o **Console de Auditoria & Failover** com a aba **MongoDB** para inspecionar o histórico persistido no banco.
* **[cliente-dashboard/src/app/simulador/page.tsx](file:///c:/Users/arthur/Desktop/IF/Trabalho%20Sistemas%20Distribuidos/trabalho-pratico-sd/cliente-dashboard/src/app/simulador/page.tsx):**
  * **Para que serve:** Interface **Mobile-First do Paciente/Aluno** (`http://localhost:3000/simulador`). Permite que vários colegas ou avaliadores abram abas (ou acessem pelo celular na mesma rede), cadastrem seu nome, cor favorita e estilo musical, entrem na Sala 1 ou na Fila de Espera, finalizem o atendimento e simulem variações de Ruído (dB) e Frequência Cardíaca (BPM) em tempo real.

---

## 📘 QUADRANTE 1: Tutorial (Aprender Fazendo — Do Zero ao Primeiro Fluxo)

> *Objetivo deste quadrante: Guiar você passo a passo, a partir do computador recém-ligado, para subir toda a infraestrutura, iniciar os microsserviços e executar seu primeiro atendimento clínico distribuído com sucesso.*

### 1.1 Pré-requisitos e Preparação dos Containers Docker

Antes de iniciar os códigos em TypeScript, precisamos garantir que o **Broker MQTT (Mosquitto)** e os **3 Bancos de Dados MongoDB independentes** estejam rodando no Docker.

1. Abra o seu terminal na pasta raiz do projeto (`trabalho-pratico-sd`):
   ```bash
   # Navega até a pasta do projeto
   cd "c:\Users\arthur\Desktop\IF\Trabalho Sistemas Distribuidos\trabalho-pratico-sd"
   ```
2. Suba os 4 containers em segundo plano (*detached mode*):
   ```bash
   # Cria e inicia os containers mqtt-broker, mongo1, mongo2 e mongo3
   docker compose up -d
   ```
3. Verifique se todos os 4 containers estão com status `Up` (rodando):
   ```bash
   # Lista o status e o mapeamento de portas dos containers ativos
   docker compose ps
   ```
   **Saída esperada:**
   - `mqtt-broker` ativo na porta `0.0.0.0:1883->1883/tcp`
   - `mongo1` ativo na porta `0.0.0.0:27017->27017/tcp`
   - `mongo2` ativo na porta `0.0.0.0:27018->27017/tcp`
   - `mongo3` ativo na porta `0.0.0.0:27019->27017/tcp`

---

### 1.2 Instalação de Dependências e Inicialização do Sistema

Caso seja a primeira vez executando o projeto (ou após clonar o repositório), instale os pacotes Node.js na raiz e no frontend:

```bash
# 1. Instala as dependências do backend (gRPC, MQTT, MongoDB Driver, tsx)
npm install

# 2. Entra na pasta do frontend Next.js e instala suas dependências
cd cliente-dashboard
npm install

# 3. Retorna para a pasta raiz do projeto
cd ..
```

Agora você pode escolher **uma das duas formas abaixo** para iniciar os serviços:

#### Opção A: Inicialização Rápida em 1 Comando (Modo Automatizado)
Ideal para desenvolvimento rápido ou quando você quer ver todos os logs consolidados e coloridos em uma única janela:

```bash
# Inicia os 3 controladores, 3 sensores, 3 atuadores e o Next.js simultaneamente
npm run start:all
```
*(No Windows, você também pode dar dois cliques em `iniciar-tudo.bat` ou rodar `./iniciar-tudo.ps1` no PowerShell).*

#### Opção B: Inicialização em Terminais Separados (Modo Didático para Apresentação ao Professor)
> [!TIP]
> **Recomendado para a Defesa Acadêmica:** Abrir terminais separados permite que o professor veja exatamente o que cada processo isolado está fazendo e permite derrubar apenas o Controlador 1 (`Ctrl + C`) para demonstrar o *Failover* ao vivo!

Com o Docker já rodando (`docker compose up -d`), abra **7 a 10 terminais** na pasta `trabalho-pratico-sd` e execute:

* **Terminal 1 — Controlador 1 (Líder Primário gRPC `:3001` / Mongo `:27017`):**
  ```bash
  npm run ctrl1
  ```
* **Terminal 2 — Controlador 2 (Réplica Honesta e Líder Interino gRPC `:3002` / Mongo `:27018`):**
  ```bash
  npm run ctrl2
  ```
* **Terminal 3 — Controlador 3 (Réplica Bizantina gRPC `:3003` / Mongo `:27019`):**
  ```bash
  npm run ctrl3
  ```
* **Terminal 4 — Atuador de Iluminação RGB (Subscriber MQTT):**
  ```bash
  npm run atuador:luz
  ```
* **Terminal 5 — Atuador Smart Speaker (Subscriber MQTT):**
  ```bash
  npm run atuador:speaker
  ```
* **Terminal 6 — Atuador Display da Porta (Subscriber MQTT):**
  ```bash
  npm run atuador:display
  ```
* **Terminal 7 — Frontend Dashboard & Gateway gRPC (Next.js Porta `:3000`):**
  ```bash
  cd cliente-dashboard && npm run dev
  ```
* *(Opcionais)* **Terminais 8, 9 e 10 — Sensores IoT via CLI Interativo:**
  ```bash
  # Terminal 8 (Sensor de Ruído dB):
  npm run sensor:ruido

  # Terminal 9 (Sensor de Pulseira Cardíaca BPM):
  npm run sensor:bpm

  # Terminal 10 (Sensor de Porta / Presença RFID):
  npm run sensor:presenca
  ```

---

### 1.3 Primeira Execução Guiada: Ciclo Completo de Atendimento

Com o sistema no ar, vamos realizar um teste completo de ponta a ponta:

1. **Abra o Dashboard Clínico:** Acesse `http://localhost:3000` no navegador.
   - Observe no topo o banner esmeralda: **"Quorum 2x1 Validado no Backend — Voto bizantino do Nó 3 descartado pelo Líder."**
   - Veja os 3 cards de réplicas: **Controlador 1** (`Líder`), **Controlador 2** (`Voto Válido`) e **Controlador 3** (`Bizantino`).
2. **Abra o Simulador Mobile:** Em outra aba (ou lado a lado), acesse `http://localhost:3000/simulador`.
3. **Cadastre e Admita um Paciente:**
   - No campo **Identificação da Criança**, digite `Arthur`.
   - Em **Cor Favorita (Luz)**, selecione `Azul`.
   - Em **Estilo Musical (Som)**, selecione `Rock`.
   - Clique em **Salvar Preferências** (e se a sala estiver livre, clique em **Simular Entrada**).
4. **Acompanhe a Mágica Acontecendo nas Camadas:**
   - **No Terminal do Controlador 1:** Você verá o Líder receber o evento MQTT `clinica/recepcao/checkin`, consultar os nós 2 e 3 via gRPC `VotarEstado`, rejeitar o voto falsificado do Nó 3 (`999 dB / 250 BPM`), aprovar o **Quorum 2x1 (2/3 votos)**, gravar no MongoDB 1 e replicar via `EfetivarEstado` para os MongoDBs 2 e 3.
   - **Nos Terminais dos 3 Atuadores:** Instantaneamente, a lâmpada muda para `Cor Favorita (Azul)`, o Smart Speaker inicia `Playlist do Paciente (Rock)` e o Display da Porta exibe `> Em Atendimento (Arthur)`.
   - **No Dashboard (`http://localhost:3000`):** Os cards de atuadores, o nome do paciente e a lista de **Histórico de Eventos (MongoDB)** são atualizados automaticamente em menos de meio segundo!

---

## 🛠️ QUADRANTE 2: How-To Guides (Roteiros Práticos de Operação e Defesa Acadêmica)

> *Objetivo deste quadrante: Fornecer receitas diretas ("Como fazer...") para demonstrar cada requisito de avaliação do trabalho prático perante o professor.*

---

### 2.1 Como demonstrar o Quorum 2x1 e a Rejeição de Falha Bizantina

**Cenário de Avaliação:** Provar que o Controlador 3 está comprometido (enviando valores absurdos), mas o sistema detecta a divergência e impede que dados adulterados corrompam os bancos MongoDB ou disparem alarmes falsos nos atuadores.

1. Certifique-se de que os 3 controladores estão rodando e que no topo do Dashboard (`http://localhost:3000`) o botão direito indica **"Falha Bizantina Ativa"**.
2. Vá ao Simulador Mobile (`http://localhost:3000/simulador`) ou ao terminal do `sensorRuido.ts` e envie um nível de ruído seguro, por exemplo: **`68 dB`**.
3. Observe imediatamente o log no terminal do **Controlador 1 (Líder)**:
   ```text
   🗳️ [controlador-1] Submetendo estado candidato à votação de Quorum (TELEMETRIA)...
   ⚖️ [controlador-1] QUORUM 2x1 ALCANÇADO (2/3 votos): [Líder (:3001): APROVADO | Réplica 2 (:3002): APROVADO (Voto Íntegro) | Réplica 3 (:3003): DESCARTADO POR FALHA BIZANTINA (Ruído: 999dB, BPM: 250)]
   ✅ [controlador-1] Estado validado persistido no MongoDB 1 e replicado nas instâncias 2 e 3.
   ```
4. **O que explicar ao professor:**
   - Embora o Controlador 3 tenha respondido à RPC `VotarEstado` afirmando que a sala estava com `999 dB`, `250 BPM` e em crise (`modoCalmaAtivo: true`), a função `compararEstados()` no Líder comparou a assinatura completa do estado do Nó 3 com o estado calculado pelo Líder e pelo Nó 2.
   - Como o Nó 1 e o Nó 2 concordaram em `68 dB`, formou-se maioria simples (**Quorum 2x1**).
   - O voto do Nó 3 foi descartado e, na fase seguinte (`EfetivarEstado`), o Líder forçou a gravação do valor correto (`68 dB`) também no `mongo3` (`27019`), impedindo que o banco do nó bizantino ficasse corrompido!

---

### 2.2 Como alternar o Controlador 3 entre Modo Bizantino e Modo Honesto (Consenso 3x3)

**Cenário de Avaliação:** Demonstrar que a falha bizantina não é um texto estático (*hardcoded* na tela), mas sim uma verificação real voto a voto via gRPC.

1. No cabeçalho superior direito do Dashboard (`http://localhost:3000`), clique no botão vermelho **"Falha Bizantina Ativa"**.
2. O Gateway Next.js enviará uma chamada gRPC `ToggleBizantino` diretamente para o Controlador 3 (`localhost:3003`).
3. Veja o log no terminal do **Controlador 3**:
   ```text
   🔄 [controlador-3] Simulação de Falha Bizantina: DESATIVADA (Modo Honesto)
   ```
4. No Dashboard, observe a mudança imediata:
   - O botão muda para **"Simular Ataque/Falha"**.
   - O card do **Controlador 3** muda de vermelho (`Bizantino`) para esmeralda (**`Voto Válido`**).
   - O banner principal do sistema muda para: **"Consenso Unânime (3/3) — 3 réplicas íntegras sincronizadas no Backend."**
5. Mova qualquer slider no `/simulador` e veja no terminal do Controlador 1:
   ```text
   ⚖️ [controlador-1] CONSENSO UNÂNIME (3/3 votos): [Líder (:3001): APROVADO | Réplica 2 (:3002): APROVADO (Voto Íntegro) | Réplica 3 (:3003): APROVADO (Voto Íntegro)]
   ```
6. Clique novamente no botão para reativar a falha bizantina quando desejar.

---

### 2.3 Como demonstrar Queda do Líder (Crash), Failover com Líder Interino (C2) e Catch-up na Volta

**Cenário de Avaliação:** Provar que se o Controlador 1 (primário) cair, o sistema **não para**: o cliente continua executando métodos remotos, a telemetria MQTT continua sendo gravada nos bancos e os atuadores físicos continuam recebendo comandos. E, quando o Controlador 1 volta, ele recupera tudo o que perdeu!

#### Parte A: Derrubando o Líder Primário (Controlador 1)
1. Vá ao terminal onde o **Controlador 1** (`npm run ctrl1`) está rodando e pressione **`Ctrl + C`** para matar o processo.
2. Olhe para o terminal do **Controlador 2** (`npm run ctrl2`). Em no máximo `1,5 segundo`, o *heartbeat* detectará a queda e imprimirá:
   ```text
   👑 [controlador-2] Controlador 1 offline! Assumindo liderança interina (Failover).
   ```
3. Olhe para o Dashboard (`http://localhost:3000`):
   - O card do Controlador 1 ficará cinza com o badge **`Offline`**.
   - O card do Controlador 2 exibirá **`Líder Interino (Failover)`**.
   - O banner superior ficará âmbar: **"Failover Ativo — Controlador 2 operando como Líder Interino (Nó 1 Offline)."**

#### Parte B: Operando a Clínica Durante a Queda do Nó 1
1. Com o Controlador 1 **desligado**, clique no botão **"Regulação Sensorial"** (ou **"Integração Lúdica"**) no Dashboard.
2. Observe o **Console de Auditoria & Failover** na coluna direita do Dashboard:
   ```text
   [METODO] [Cliente 1 (Médico)] Invocando configurarAtuadores(IntegracaoLudica) no Controlador 1 (:3001)...
   [FAILOVER] Controlador 1 offline (HTTP 503). Acionando Failover automático para Controlador 2 (:3002)...
   [INFO] Failover concluído com sucesso pelo Controlador 2 (:3002) via gRPC [Cliente 1 (Médico)]
   ```
3. Observe os terminais dos **3 Atuadores (`iluminacao`, `smartSpeaker`, `displayPorta`)**:
   - Eles recebem normalmente os comandos MQTT publicados pelo **Controlador 2 (`origem: controlador-2`)**!
4. Teste também enviar ruído alto (`95 dB`) pelo `/simulador` com o C1 desligado: o **Controlador 2** processará a telemetria MQTT, fará votação com o C3, gravará no `mongo2` (`27018`), replicará para o `mongo3` (`27019`) e acionará o protocolo de calma nos atuadores!

#### Parte C: Religando o Controlador 1 (Crash-Recovery + Catch-up)
1. No terminal do Controlador 1, inicie-o novamente:
   ```bash
   npm run ctrl1
   ```
2. Observe os logs de inicialização do **Controlador 1**:
   - Primeiro, ele carrega seu banco local (`mongo1` na porta `27017`).
   - Em seguida, ele consulta o Controlador 2 (`:3002`) via gRPC e percebe que o C2 processou novos eventos durante o período de queda:
     ```text
     🔄 [controlador-1] Catch-up concluído: Estado sincronizado a partir do Controlador 2 (:3002) e salvo no MongoDB 1.
     ```
3. No terminal do **Controlador 2**, o *heartbeat* detecta o retorno do Líder 1:
   ```text
   ℹ️ [controlador-2] Controlador 1 (:3001) voltou a ficar online. Retornando ao papel de Réplica Honesta.
   ```
4. O cluster volta ao estado nominal sem perder nenhum paciente da fila e nenhum evento do histórico!

---

### 2.4 Como demonstrar Múltiplos Clientes (Médico vs. Enfermagem) e a Trava Manual de 15s

**Cenário de Avaliação:** Demonstrar a invocação de métodos remotos por múltiplos clientes identificados e como uma decisão clínica manual tem prioridade sobre sensores por 15 segundos.

1. No cabeçalho do Dashboard (`http://localhost:3000`), localize o seletor de perfil:
   - **`Cliente 1 (Médico)`**
   - **`Cliente 2 (Enfermagem)`**
2. Selecione **`Cliente 1 (Médico)`** e clique no preset **"2. Integração Lúdica"** (Luz `Verde / Viva`, Som `Sons da Natureza`, Porta `> Sessão Lúdica em Andamento`).
3. Veja no Console de Auditoria e no Histórico do MongoDB a assinatura explícita: `[Cliente 1 (Médico)] Preset aplicado: Integração Lúdica`.
4. Agora mude o seletor no topo para **`Cliente 2 (Enfermagem)`** (ou abra uma segunda aba do Dashboard com `Cliente 2 (Enfermagem)` selecionado) e clique em **"1. Regulação Sensorial"**.
5. O sistema registra `[Cliente 2 (Enfermagem)] Protocolo de Regulação Sensorial ativado manualmente` e ativa um **Override Manual de 15 segundos** (`overrideManualAte = Date.now() + 15000`).
6. Durante esses 15 segundos, mesmo que os sensores enviem ruído baixo (`50 dB`) e BPM normal (`75 BPM`), o controlador **não desliga** o modo de calma, respeitando a prescrição manual da enfermagem/médico até o tempo expirar!

---

### 2.5 Como demonstrar a Fila de Espera Distribuída com Múltiplos Pacientes

**Cenário de Avaliação:** Provar que a sala possui exclusão mútua (apenas 1 criança atendida por vez) e transição automática de fila com personalização de ambiente.

1. Abra **duas abas** no endereço `http://localhost:3000/simulador` (Aba A e Aba B).
2. **Na Aba A (Primeiro Paciente):**
   - Nome: `Lucas` | Cor: `Azul` | Música: `Rock`.
   - Clique em **Salvar Preferências** (e **Simular Entrada** se necessário).
   - Veja que `Lucas` entra em atendimento na Sala 1. Os atuadores mudam para Luz `Azul` e Playlist `Rock`.
3. **Na Aba B (Segundo Paciente chegando com a sala ocupada):**
   - Nome: `Mariana` | Cor: `Verde` | Música: `Clássica`.
   - Clique em **Salvar Preferências**.
   - Como a Sala 1 está ocupada pelo `Lucas`, o controlador coloca `Mariana` automaticamente na **Fila de Espera (1º da fila)** e grava a fila nos 3 MongoDBs após consenso Quorum 2x1!
4. **Na Aba A (Saída do Lucas):**
   - Clique no botão vermelho **"Finalizar Atendimento (Liberar Sala)"** (ou digite `sair` no terminal do `sensorPresenca.ts`).
5. **Transição Automática Instantânea:**
   - O Controlador Líder detecta a saída do `Lucas`, executa `filaEspera.shift()`, promove `Mariana` automaticamente para dentro da Sala 1 e reconfigura os 3 atuadores físicos para as preferências da `Mariana` (Luz `Cor Favorita (Verde)`, Som `Playlist do Paciente (Clássica)` e Porta `> Em Atendimento (Mariana)`).

---

## 📖 QUADRANTE 3: Reference (Especificação Técnica Exata do Sistema)

> *Objetivo deste quadrante: Servir como dicionário técnico definitivo de portas, tópicos MQTT, mensagens Protobuf, schemas de banco de dados e tabelas de regras clínicas.*

---

### 3.1 Topologia de Rede e Mapa de Portas

| Porta | Protocolo | Serviço / Processo | Arquivo / Container Responsável | Papel na Arquitetura |
| :---: | :---: | :--- | :--- | :--- |
| **`1883`** | MQTT (TCP) | Broker Eclipse Mosquitto | Container `mqtt-broker` (`docker-compose.yml`) | Barramento central Publish/Subscribe para sensores, atuadores e controladores. |
| **`27017`** | MongoDB Wire | Instância MongoDB 1 | Container `mongo1` (`docker-compose.yml`) | Banco NoSQL isolado exclusivo do **Controlador 1** (`mongodb://127.0.0.1:27017/diverterapia`, configurável via `MONGO_URI_1`). |
| **`27018`** | MongoDB Wire | Instância MongoDB 2 | Container `mongo2` (`docker-compose.yml`) | Banco NoSQL isolado exclusivo do **Controlador 2** (`mongodb://127.0.0.1:27018/diverterapia`, configurável via `MONGO_URI_2`). |
| **`27019`** | MongoDB Wire | Instância MongoDB 3 | Container `mongo3` (`docker-compose.yml`) | Banco NoSQL isolado exclusivo do **Controlador 3** (`mongodb://127.0.0.1:27019/diverterapia`, configurável via `MONGO_URI_3`). |
| **`3000`** | HTTP / REST | Next.js 14 (Web + BFF) | `cliente-dashboard/` (`npm run dev`) | Serve o Dashboard (`/`), o Simulador (`/simulador`) e o Gateway gRPC (`/api/*`). |
| **`3001`** | gRPC (HTTP/2) | Controlador 1 (Líder) | `controladores/controlador1.ts` | Servidor gRPC puro do Coordenador Primário do cluster. |
| **`3002`** | gRPC (HTTP/2) | Controlador 2 (Honesto) | `controladores/controlador2.ts` | Servidor gRPC puro da Réplica Honesta e Líder Interino de *Failover*. |
| **`3003`** | gRPC (HTTP/2) | Controlador 3 (Bizantino) | `controladores/controlador3.ts` | Servidor gRPC puro da Réplica Bizantina com injeção *toggleável* de falhas. |

---

### 3.2 Catálogo Completo de Tópicos MQTT e Payloads JSON

| Tópico MQTT | Direção | Publicador (Publisher) | Assinante (Subscriber) | Exemplo de Payload JSON |
| :--- | :---: | :--- | :--- | :--- |
| `clinica/sala1/ruido` | Sensor $\rightarrow$ Ctrl | `sensorRuido.ts` ou `/simulador` | Controladores 1, 2 e 3 | `{"db": 72, "timestamp": "2026-11-19T20:00:00.000Z"}` |
| `clinica/sala1/bpm` | Sensor $\rightarrow$ Ctrl | `sensorBPM.ts` ou `/simulador` | Controladores 1, 2 e 3 | `{"bpm": 88, "timestamp": "2026-11-19T20:00:00.000Z"}` |
| `clinica/sala1/porta` | Sensor $\rightarrow$ Ctrl | `sensorPresenca.ts` ou `/simulador` | Controladores 1, 2 e 3 | `{"presenca": true, "nome": "Arthur"}` |
| `clinica/sala1/presenca` | Sensor $\rightarrow$ Ctrl | Alias de presença física | Controladores 1, 2 e 3 | `{"presenca": false, "tagId": "NENHUM"}` |
| `clinica/recepcao/checkin` | App $\rightarrow$ Ctrl | `/simulador` via `/api/mqtt/publish` | Controladores 1, 2 e 3 | `{"acao": "entrar_fila", "nome": "Leo", "cor": "Azul", "musica": "Rock"}` |
| `clinica/sala1/comando/luz` | Ctrl $\rightarrow$ Atuador | Líder Ativo (C1 ou C2 Interino) | `atuadores/iluminacao.ts` | `{"cor": "Azul / Calmante", "origem": "controlador-1", "timestamp": "..."}` |
| `clinica/sala1/comando/som` | Ctrl $\rightarrow$ Atuador | Líder Ativo (C1 ou C2 Interino) | `atuadores/smartSpeaker.ts` | `{"som": "Frequência Calmante (Ruído Branco)", "origem": "controlador-1"}` |
| `clinica/sala1/comando/display` | Ctrl $\rightarrow$ Atuador | Líder Ativo (C1 ou C2 Interino) | `atuadores/displayPorta.ts` | `{"mensagem": "> Regulação em Curso (Não Entre)", "origem": "controlador-1"}` |

---

### 3.3 Dicionário do Contrato Protobuf (`proto/diverterapia.proto`)

Abaixo está a referência comentada linha a linha do contrato `proto/diverterapia.proto`:

```protobuf
// Define a utilização da versão 3 do Protocol Buffers
syntax = "proto3";

// Define o namespace do pacote gRPC compartilhado entre backend e frontend
package diverterapia;

// ============================================================================
// 1. SERVIÇO EXTERNO: Invocado pelo Gateway Next.js (Clientes Médico/Enfermagem)
// ============================================================================
service MiddlewareClinico {
  // Retorna a fotografia completa do estado atual da sala naquele controlador
  rpc ObterStatus (Empty) returns (EstadoSalaResponse);
  
  // Aciona diretamente o Protocolo de Regulação Sensorial com trava de 15 segundos
  rpc AtivarModoCalmaManual (OrigemRequest) returns (SucessoResponse);
  
  // Invoca métodos remotos orientados a objetos (ex: configurarAtuadores)
  rpc InvocarMetodo (InvocarMetodoRequest) returns (SucessoResponse);
  
  // Alterna o Controlador 3 entre Modo Bizantino (999dB/250BPM) e Modo Honesto
  rpc ToggleBizantino (Empty) returns (SucessoResponse);
}

// ============================================================================
// 2. SERVIÇO INTERNO: Invocado pelo Líder (C1 ou C2 Interino) para Consenso
// ============================================================================
service ConsensoInterno {
  // Fase 1 (Prepare/Vote): Solicita o estado calculado pela réplica para votação
  rpc VotarEstado (VotoRequest) returns (VotoResponse);
  
  // Fase 2 (Commit): Ordena que a réplica persista o estado aprovado por Quorum
  rpc EfetivarEstado (EstadoSalaRequest) returns (SucessoResponse);
}
```

**Resumo das Mensagens do Contrato:**
- `InvocarMetodoRequest`: Contém `metodo` (`"configurarAtuadores"` ou `"ativarModoCalmaManual"`), `origem` (`"Cliente 1 (Médico)"` ou `"Cliente 2 (Enfermagem)"`) e `parametros` (`modo`, `iluminacao`, `smartSpeaker`, `displayPorta`).
- `SucessoResponse`: Retorna `sucesso` (`bool`), `mensagem` (`string`), `controlador` (`string`), `protocolo` (`string`), `metodoExecutado` (`string`), `estadoAtual` (`EstadoSalaData`) e `simularFalhaBizantina` (`bool`).
- `VotoResponse`: Retorna `controladorId`, `aprovado` (`bool`), `estadoProposto` (`EstadoSalaData`) e `timestamp`.

---

### 3.4 Modelagem de Dados no MongoDB (Coleção `estados_sala`)

Cada controlador conecta via **Mongoose (`^8.8.1`)** à sua própria instância (`MONGO_URI_1`, `MONGO_URI_2`, `MONGO_URI_3`, com padrão `mongodb://127.0.0.1:27017..27019/diverterapia`) e grava na coleção `estados_sala` via operação atômica `findOneAndUpdate({ salaId: "sala-1" }, { $set: ... }, { upsert: true, new: true })`:

```javascript
// Estrutura comentada linha a linha do documento persistido nos 3 MongoDBs
{
  // Identificador único da sala monitorada (chave primária lógica do upsert)
  "salaId": "sala-1",
  // Último nível de ruído acústico validado por Quorum (em decibéis)
  "ruidoDb": 68,
  // Última frequência cardíaca validada por Quorum (em batimentos por minuto)
  "bpm": 82,
  // Indica se há uma criança fisicamente dentro da Sala 1 no momento
  "presenca": true,
  // Nome ou código da tag RFID do paciente atualmente em atendimento
  "tagId": "Arthur",
  // Estilo musical preferido informado pelo paciente atual
  "musicaFavorita": "Rock",
  // Cor de iluminação preferida informada pelo paciente atual
  "corFavorita": "Azul",
  // Estado atual aplicado ao atuador físico de Iluminação RGB
  "iluminacao": "Cor Favorita (Azul)",
  // Estado atual aplicado ao atuador físico Smart Speaker
  "smartSpeaker": "Playlist do Paciente (Rock)",
  // Mensagem atual projetada no atuador físico Display da Porta
  "displayPorta": "> Em Atendimento (Arthur)",
  // Flag que indica se a sala está em crise/Protocolo de Regulação Sensorial
  "modoCalmaAtivo": false,
  // Timestamp em milissegundos até quando vale a trava manual de 15 segundos
  "overrideManualAte": 1732047600000,
  // Timestamp ISO 8601 da última transição aprovada pelo Quorum
  "ultimaAtualizacao": "2026-11-19T20:30:00.000Z",
  // Trilha de auditoria contendo os últimos 15 eventos aprovados pelo cluster
  "historico": [
    {
      // Horário ISO 8601 exato da gravação do evento
      "horario": "2026-11-19T20:30:05.000Z",
      // Categoria do evento (INICIALIZACAO, TELEMETRIA, INVOCACAO_METODO, CONSENSO)
      "tipo": "TELEMETRIA",
      // Descrição detalhada incluindo o selo de auditoria do consenso
      "descricao": "Ruído do Simulador: 68 dB [Consenso Quorum 2/3 Aprovado]"
    }
  ]
}
```

---

### 3.5 Tabela Oficial das 4 Combinações Clínicas e Limiares Sensoriais

O motor `controladores/regrasClinicas.ts` governa os atuadores seguindo rigorosamente os limiares e combinações abaixo:

* **Limiar de Crise Acústica:** `ruidoDb > 85` (acima de 85 decibéis).
* **Limiar de Crise Fisiológica (Taquicardia):** `bpm > 120` (acima de 120 batimentos por minuto).

| # | Modo Clínico | Gatilho de Ativação | Atuador 1: Iluminação RGB | Atuador 2: Smart Speaker | Atuador 3: Display da Porta |
| :-: | :--- | :--- | :--- | :--- | :--- |
| **1** | **Regulação Sensorial** | Automático (`Ruído > 85 dB` ou `BPM > 120`) ou Botão Manual | `Azul / Calmante` | `Frequência Calmante (Ruído Branco)` | `> Regulação em Curso (Não Entre)` |
| **2** | **Integração Lúdica** | Invocação Remota (`Cliente 1` ou `Cliente 2`) | `Verde / Viva` | `Sons da Natureza` | `> Sessão Lúdica em Andamento` |
| **3** | **Foco Dirigido** | Invocação Remota (`Cliente 1` ou `Cliente 2`) | `Branca / Alto Contraste` | `Isolamento Acústico` | `> Sessão de Foco (Silêncio)` |
| **4** | **Perfil do Paciente** | Entrada de Paciente na Sala ou Botão Manual | `Cor Favorita (<Cor>)` | `Playlist do Paciente (<Música>)` | `> Em Atendimento (<Nome>)` |
| **-** | **Sala Livre (Standby)** | Saída do Paciente com Fila de Espera Vazia | `Branca / Suave (Sala Livre)` | `Desligado` | `> Sala Livre (Aguardando Paciente)` |

---

## 💡 QUADRANTE 4: Explanation (Fundamentação Teórica e Decisões de Arquitetura)

> *Objetivo deste quadrante: Explicar profundamente o "Porquê" de cada decisão arquitetural para embasar a defesa teórica do grupo na disciplina de Sistemas Distribuídos.*

---

### 4.1 A Tríade de Protocolos: Por que combinar MQTT, gRPC e HTTP/REST?

Uma dúvida comum ao analisar o projeto é: *"Por que não usar apenas HTTP em tudo, ou apenas MQTT em tudo?"* Em Sistemas Distribuídos modernos, cada camada possui requisitos físicos e computacionais diferentes:

1. **Por que MQTT na borda IoT (Sensores e Atuadores)?**
   - Sensores reais (ESP32, Arduino, pulseiras BLE/Wi-Fi) possuem memória e bateria extremamente limitadas.
   - O padrão **Publish/Subscribe** via broker Mosquitto garante **desacoplamento espacial e temporal**: o sensor de ruído publica no tópico `clinica/sala1/ruido` apenas uma vez, e o broker entrega cópias simultâneas dessa mensagem para os 3 controladores sem que o sensor precise saber quantos controladores existem ou quais são seus IPs.
2. **Por que gRPC (HTTP/2 + Protobuf) entre os Controladores e o Gateway?**
   - A comunicação entre clientes/gateway e o middleware, bem como a votação de consenso entre os 3 controladores (`VotarEstado` e `EfetivarEstado`), exige **semântica de invocação de métodos remotos (RPC)** com resposta síncrona imediata, tipagem estrita e baixíssima latência.
   - O **gRPC** trafega dados serializados em binário (**Protocol Buffers**) sobre conexões **HTTP/2 multiplexadas**, tornando a votação de Quorum entre as portas `3001`, `3002` e `3003` ocorre em poucos milissegundos.
3. **Por que HTTP/REST entre o Navegador e o Next.js BFF?**
   - Navegadores web e smartphones possuem restrições nativas de segurança e APIs que impedem o controle direto de *frames* HTTP/2 exigidos pelo gRPC puro.
   - O servidor Next.js na porta `3000` atua como um **Gateway BFF (*Backend-For-Frontend*)**: ele recebe requisições HTTP/JSON simples da interface React e executa as chamadas gRPC nativas via `@grpc/grpc-js` no backend Node.js.

---

### 4.2 Como funciona o Algoritmo de Consenso e Quorum no Backend?

Em arquiteturas ingênuas, cada controlador recebe dados do sensor e grava imediatamente no seu banco de dados, deixando para o frontend decidir qual banco exibir. **Isso é um erro arquitetural grave**, pois permitiria que um nó malicioso corrompesse seu banco de dados permanentemente e gerasse estados divergentes entre as réplicas.

No Diverterapia, implementamos o consenso **antes do commit e antes da atuação física**:

$$\text{1. Proposta (Estado Candidato)} \longrightarrow \text{2. Votação gRPC (Quorum 2x1)} \longrightarrow \text{3. Commit nos 3 MongoDBs} \longrightarrow \text{4. Ordem MQTT aos Atuadores}$$

#### Como evitamos Condições de Corrida (*Race Conditions*) no MQTT?
Como o broker Mosquitto entrega as mensagens de telemetria de forma assíncrona para os 3 controladores, o Controlador 1 (Líder) poderia receber uma mensagem `10 milissegundos` antes do Controlador 2. Se o Líder pedisse o voto do Controlador 2 imediatamente, o Controlador 2 ainda estaria com o valor antigo na memória e divergiria sem querer!

Para resolver esse problema clássico de sincronização em Sistemas Distribuídos, aplicamos **três mecanismos combinados**:
1. **Fila Sequencial de Operações (`enfileirarOperacao`):** O Líder processa uma transição por vez em fila FIFO, impedindo que rajadas de sensores misturem estados candidatos concorrentes.
2. **Janela de Propagação e Sincronização Fina (`VotarEstado`):** Antes de abrir a urna de votação, o Líder aguarda `40ms` para propagação local do socket TCP do Mosquitto. Além disso, ao receber `VotarEstado`, a Réplica 2 verifica se já recebeu o pacote MQTT correspondente; caso o pacote ainda esteja em trânsito no loop de eventos, ela aguarda até `160ms` (em fatias de `20ms`) antes de emitir seu parecer final.
3. **Retry Determinístico:** Caso haja um atraso transitório de rede no nó honesto, o Líder realiza uma reconsulta rápida após `80ms` antes de encerrar a apuração.

---

### 4.3 O Problema dos Generais Bizantinos aplicado à Clínica

Formulado por Lamport, Shostak e Pease (1982), o **Problema dos Generais Bizantinos** descreve o desafio de alcançar consenso em um sistema distribuído onde componentes podem não apenas parar de funcionar, mas **mentir deliberadamente** (retornando dados corrompidos ou maliciosos).

Considere o que aconteceria se a clínica usasse uma **média aritmética simples** entre os 3 controladores quando a criança está tranquila (`60 dB`), mas o Controlador 3 sofre uma falha bizantina (`999 dB`):

$$\text{Média Simples} = \frac{60\text{ dB (Nó 1)} + 60\text{ dB (Nó 2)} + 999\text{ dB (Nó 3)}}{3} = 373\text{ dB (Falso Positivo Catastrófico!)}$$

Um único nó defeituoso dispararia um falso alarme de crise sensorial na sala!

**Como o Diverterapia neutraliza a Falha Bizantina:**
- Em vez de média numérica, o algoritmo `compararEstados()` realiza **Comparação por Congruência de Assinatura de Estado**.
- O Líder compara o vetor completo de atributos clínicos (`ruidoDb`, `bpm`, `presenca`, `tagId`, `iluminacao`, `smartSpeaker`, `displayPorta`, `modoCalmaAtivo` e `filaEspera`).
- Como `Nó 1 == Nó 2` (`60 dB`) e `Nó 3 != Nó 1` (`999 dB`), o sistema forma maioria simples de **2 contra 1 (Quorum 2x1)**, isola o Nó 3 como bizantino e **sobrescreve o banco de dados do Nó 3** via `EfetivarEstado` com o estado íntegro aprovado pela maioria.

---

### 4.4 Alta Disponibilidade: Failover, Liderança Interina e Catch-up

O sistema tolera falhas de parada (*Crash Faults*) tanto na camada de requisição do cliente quanto na camada de processamento IoT:

1. **Failover no Cliente/Gateway (`grpcClient.ts`):** Quando o médico clica em um botão no Dashboard e o Controlador 1 (`:3001`) está desligado, o cliente gRPC captura o erro de conexão e reenvia a chamada instantaneamente para o Controlador 2 (`:3002`).
2. **Liderança Interina no Backend (`controlador2.ts`):** Se apenas o Gateway fizesse failover, os sensores MQTT continuariam sem ninguém para coordenar o banco e os atuadores enquanto o Nó 1 estivesse morto. Por isso, o Controlador 2 monitora o Controlador 1 via *heartbeat* gRPC a cada `1500ms`. Ao detectar a queda do Nó 1, o Controlador 2 assume como **Líder Interino**, passando a coordenar os votos, gravar nos bancos ativos e publicar comandos nos atuadores MQTT.
3. **Recuperação com Catch-up (`controlador1.ts`, `controlador2.ts` e `controlador3.ts`):** Quando o Controlador 1 é religado, ele executa `sincronizarCatchUpComReplica2()` consultando o Controlador 2 (`:3002`) via gRPC `ObterStatus` para absorver alterações ocorridas durante o *failover*. Da mesma forma, quando os Controladores 2 ou 3 reiniciam após uma queda, eles executam `sincronizarCatchUpComLider()` para recuperar do Líder (ou da Réplica 2 em *fallback*) qualquer evento clínico perdido antes de retomar a votação, com suporte a reconexão automática ao MongoDB a cada `10s`.

---

### 4.5 Matriz de Conformidade com a Especificação Oficial e Fases 1, 2 e 3

Use esta tabela como guia rápido de comprovação durante a arguição com o professor:

| Requisito da Especificação / Fase de Aula | Status | Onde está implementado no código real? |
| :--- | :---: | :--- |
| **Barramento MQTT (Mosquitto no Docker na porta 1883)** | ✅ 100% | `docker-compose.yml` (serviço `mqtt-broker` na porta `1883`). |
| **Sensores apenas publicam (Pure Publishers)** | ✅ 100% | `sensores/sensorRuido.ts`, `sensorBPM.ts` e `sensorPresenca.ts` (apenas `client.publish`). |
| **Atuadores apenas assinam (Pure Subscribers)** | ✅ 100% | `atuadores/iluminacao.ts`, `smartSpeaker.ts` e `displayPorta.ts` (apenas `client.subscribe`). |
| **Múltiplos Clientes e Invocação de Métodos Remotos** | ✅ 100% | `page.tsx` (`Cliente 1 (Médico)` e `Cliente 2 (Enfermagem)`) $\rightarrow$ RPC `InvocarMetodo`. |
| **Fase 1: 3 Bancos MongoDB Independentes (1 por nó)** | ✅ 100% | `docker-compose.yml` (`27017`, `27018`, `27019`) + `.env` (`MONGO_URI_1/2/3`) via `persistenciaMongo.ts`. |
| **Fase 1: Persistência via Mongoose (sem arquivos JSON locais)** | ✅ 100% | Persistência via **Mongoose (`^8.8.1`)** na coleção `estados_sala`, com status real (`[CONECTADO]` / `[OFFLINE - RAM]`) e reconexão automática a cada 10s. |
| **Fase 1: Crash-Recovery + Catch-up ao reiniciar nó** | ✅ 100% | `persistenciaMongo.inicializar()` + `sincronizarCatchUpComReplica2()` (`controlador1.ts`) e `sincronizarCatchUpComLider()` (`controlador2.ts` e `controlador3.ts`). |
| **Fase 2: Transporte gRPC Puro (`@grpc/grpc-js`)** | ✅ 100% | `proto/diverterapia.proto` + servidores gRPC puros nas portas `3001`, `3002` e `3003`. |
| **Fase 2: Failover Automático Transparente (3001 $\rightarrow$ 3002)** | ✅ 100% | `grpcClient.ts` (`invocarMetodoComFailover`) + Liderança Interina em `controlador2.ts`. |
| **Fase 3: Consenso Quorum 2x1 no Backend antes do Banco** | ✅ 100% | `executarConsensoQuorum()` em `controlador1.ts` e `controlador2.ts` (`VotarEstado` $\rightarrow$ `EfetivarEstado`). |
| **Fase 3: Tolerância a Falha Bizantina (Toggleável no Nó 3)** | ✅ 100% | `controlador3.ts` (`simularFalhaBizantina`, `999 dB / 250 BPM`, RPC `ToggleBizantino`). |

---

*Documentação elaborada sob o framework **Diátaxis** para avaliação acadêmica da disciplina de **Sistemas Distribuídos** — Projeto Middleware IoT **Diverterapia**.*
