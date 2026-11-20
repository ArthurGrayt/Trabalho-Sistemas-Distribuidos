# 🏥 Middleware IoT Distribuído Diverterapia (Sistemas Distribuídos)

> **Plataforma IoT de Regulação Sensorial Pediátrica com Replicação em 3 Bancos MongoDB, *Failover* em 2 Níveis (`C1 -> C2 -> C3`) e Tolerância a Falhas Bizantinas (*Quorum* 2x1).**

Este projeto implementa um **Middleware Distribuído de Alta Disponibilidade, Tolerância a Falhas por Parada e Segurança Bizantina** para gerenciar uma Sala Pediátrica Inteligente voltada ao acolhimento de crianças neurodivergentes (TEA/TDAH).

---

## 🎯 Soluções aos 3 Desafios Centrais da Disciplina

1. **Replicação de Dados Armazenados ("Sempre uma ou várias réplicas"):**  
   Cada controlador possui seu próprio banco MongoDB isolado (`diverterapia_ctrl1`, `diverterapia_ctrl2`, `diverterapia_ctrl3` via `.env` no **MongoDB Atlas** ou em containers Docker locais). Após o consenso pré-gravação, o Líder replica o estado via gRPC `EfetivarEstado` para todas as réplicas e realiza **Catch-up automático** ao reiniciar, com *Fallback RAM* e reconexão a cada `10s`.
2. **Garantia de Retorno Positivo ao Cliente Mesmo Após Queda (*Failover* em 2 Níveis):**  
   O Gateway Next.js redireciona chamadas automaticamente (`3001 -> 3002 -> 3003`), enquanto um monitor de *Heartbeat* (`1500ms`) promove o **Controlador 2** a Líder Interino se o C1 cair, e o **Controlador 3** (quando em Modo Honesto) a Líder Interino de 2º Nível caso C1 e C2 caiam juntos. Na interface Web, cada nó possui botões `💀 Derrubar Nó` / `⚡ Reviver Nó` e um painel dedicado para testar os **3 Cenários Distribuídos**.
3. **Segurança Contra Invasão e Erros Intermitentes (*Quorum* 2x1 + *Anti-Race Condition*):**  
   Nenhuma leitura adulterada (`999 dB`, `250 BPM` no Controlador 3 Bizantino) altera os bancos ou os atuadores: a função `compararEstados()` exige **Quorum 2x1** com congruência estrita antes do *commit* e sobrescreve o banco do nó invadido via `EfetivarEstado`. Erros intermitentes e atrasos de entrega MQTT são absorvidos por fila sequencial FIFO (`enfileirarOperacao`), janela de propagação (`40ms`), espera ativa sincronizada (até `160ms`) e *retry* determinístico (`80ms`).

---

## 🚀 Início Rápido (Portável — Sem Exigir Docker Desktop)

### 1. Configurar os Bancos MongoDB (`.env`)
- **Opção A — MongoDB Atlas Cloud (Sem Docker, pronto para clonar e rodar em qualquer PC):**  
  Certifique-se de que o arquivo `.env` na raiz contém as 3 URIs isoladas (`MONGO_URI_1`, `MONGO_URI_2` e `MONGO_URI_3` — use `.env.example` como referência) e que seu IP atual esteja liberado no *Network Access* do MongoDB Atlas.
- **Opção B — Containers Docker Locais (Alternativa Offline):**  
  Caso tenha Docker instalado e deseje rodar localmente sem internet:
  ```bash
  # Sobe o broker Eclipse Mosquitto (:1883) e 3 containers MongoDB isolados (:27017, :27018, :27019)
  docker compose up -d
  ```

### 2. Instalar Dependências

```bash
# Instala todas as dependências do backend (gRPC, MQTT, Aedes, Mongoose, TSX) na raiz
npm install

# Entra na pasta do frontend Next.js, instala dependências e retorna para a raiz
cd cliente-dashboard && npm install && cd ..
```

### 3. Iniciar Toda a Aplicação

```bash
# Inicia o Broker MQTT nativo (Aedes :1883), Controladores 1/2/3, 3 Sensores, 3 Atuadores e o Frontend Next.js (:3000)
npm run start:all
```

*(No Windows, você também pode abrir tudo em janelas separadas executando `./iniciar-tudo.ps1` ou `iniciar-tudo.bat`).*

- **Dashboard Clínico e Painel dos 3 Cenários:** [http://localhost:3000](http://localhost:3000)
- **Simulador Mobile (Paciente/Telemetria):** [http://localhost:3000/simulador](http://localhost:3000/simulador)

---

## 📚 Relatório Completo e Documentação Técnica (Diátaxis)

O relatório acadêmico completo explicando o funcionamento do sistema, as justificativas arquiteturais para cada requisito do professor, roteiro passo a passo de demonstração na defesa e especificações técnicas detalhadas está disponível em:

👉 **[Relatório Técnico e Manual Arquitetural (docs/DOCUMENTACAO_TECNICA.md)](./docs/DOCUMENTACAO_TECNICA.md)**

O documento segue os 4 quadrantes da metodologia **Diátaxis**:
1. **Explanation:** Apresentação completa do projeto e fundamentação das soluções para Replicação, *Failover* em 2 Níveis e Tolerância a Falhas Bizantinas / Intermitentes.
2. **Tutorial:** Passo a passo de instalação e execução (com MongoDB Atlas sem Docker ou via Docker Compose).
3. **How-To Guides:** Como demonstrar ao vivo na UI os 3 Cenários Distribuídos, derrubar/reviver nós, testar o *Failover* de 2º Nível no C3 e exibir os dados persistidos nos 3 bancos.
4. **Reference:** Topologia de portas, catálogo MQTT, contrato Protobuf (`proto/diverterapia.proto`), schema Mongoose e tabela oficial de combinações clínicas.

---

## 🏛️ Topologia e Portas do Sistema

| Porta | Protocolo | Componente | Papel na Arquitetura |
| :---: | :---: | :--- | :--- |
| **1883** | MQTT | Broker `Aedes` (`mqtt-broker/broker.ts`) ou Mosquitto | Barramento *Publish/Subscribe* para sensores e atuadores IoT |
| **27017 / Atlas** | MongoDB | `diverterapia_ctrl1` (`MONGO_URI_1`) | Banco isolado exclusivo do Controlador 1 (Líder) |
| **27018 / Atlas** | MongoDB | `diverterapia_ctrl2` (`MONGO_URI_2`) | Banco isolado exclusivo do Controlador 2 (Réplica / Failover 1) |
| **27019 / Atlas** | MongoDB | `diverterapia_ctrl3` (`MONGO_URI_3`) | Banco isolado exclusivo do Controlador 3 (Bizantino / Failover 2) |
| **3001** | gRPC | Controlador 1 (`controladores/controlador1.ts`) | **Líder Primário:** coordena *Quorum* 2x1 pré-gravação |
| **3002** | gRPC | Controlador 2 (`controladores/controlador2.ts`) | **Réplica Honesta / Failover 1:** assume liderança se C1 cair |
| **3003** | gRPC | Controlador 3 (`controladores/controlador3.ts`) | **Réplica Bizantina / Failover 2:** simula ataque toggleável e assume se C1+C2 caírem em Modo Honesto |
| **3000** | HTTP / Next.js | Frontend Clínico & Gateway BFF | Dashboard Médico/Enfermagem, Painel de Cenários, Crash/Recovery UI e Simulador Mobile |
