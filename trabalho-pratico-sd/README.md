# 🏥 Middleware IoT Distribuído Diverterapia (Sistemas Distribuídos)

> **Plataforma de Regulação Sensorial Pediátrica Inteligente com Alta Confiabilidade, Consenso com Líder (Quorum 2x1), gRPC, MongoDB e MQTT.**

Este projeto implementa um **Middleware Distribuído de Alta Disponibilidade e Tolerância a Falhas Bizantinas** para gerenciar uma Sala Pediátrica Terapêutica voltada ao acolhimento de crianças no espectro autista (TEA) e neurodivergentes.

---

## 🚀 Início Rápido (Quickstart)

### 1. Subir a Infraestrutura (Docker)
Inicia o broker Mosquitto (`1883`) e as 3 instâncias independentes do MongoDB (`27017`, `27018`, `27019`):
```bash
docker compose up -d
```

### 2. Instalar Dependências
```bash
# Na raiz:
npm install

# No frontend Next.js:
cd cliente-dashboard && npm install && cd ..
```

### 3. Iniciar Toda a Aplicação
Executa simultaneamente os 3 controladores gRPC, os 3 sensores IoT, os 3 atuadores e o frontend Next.js (conectados ao Mosquitto e MongoDBs do Docker):
```bash
npm run start:all
```

- **Dashboard Clínico:** [http://localhost:3000](http://localhost:3000)
- **Simulador Mobile (Alunos/Recepção):** [http://localhost:3000/simulador](http://localhost:3000/simulador)

---

## 📚 Documentação Técnica Completa (Diátaxis)

Para entender a fundo como cada engrenagem do projeto funciona, para que serve cada componente e a teoria acadêmica de Sistemas Distribuídos aplicada, acesse o nosso manual técnico completo:

👉 **[Manual Técnico e Arquitetural (docs/DOCUMENTACAO_TECNICA.md)](./docs/DOCUMENTACAO_TECNICA.md)**

A documentação está estruturada nos 4 quadrantes da metodologia Diátaxis:
1. **Tutorial:** Guia prático de primeiros passos do zero ao primeiro atendimento na sala.
2. **How-To Guides:** Como testar Quorum 2x1, injeção de falhas bizantinas e failover automático.
3. **Reference:** Dicionário completo de portas, tópicos MQTT, schemas MongoDB e contrato Protobuf (`diverterapia.proto`).
4. **Explanation:** Fundamentação teórica de Sistemas Distribuídos (por que consenso no backend, problema dos generais bizantinos, comparação MQTT vs. gRPC vs. HTTP).

---

## 🏛️ Topologia e Portas do Sistema

| Porta | Protocolo | Componente | Papel na Arquitetura |
| :---: | :---: | :--- | :--- |
| **1883** | MQTT | Eclipse Mosquitto | Barramento Publish/Subscribe para sensores e atuadores IoT |
| **27017** | MongoDB | Instância `mongo1` | Banco de dados exclusivo do Controlador 1 (Líder) |
| **27018** | MongoDB | Instância `mongo2` | Banco de dados exclusivo do Controlador 2 (Réplica Honesta) |
| **27019** | MongoDB | Instância `mongo3` | Banco de dados exclusivo do Controlador 3 (Réplica Bizantina) |
| **3001** | gRPC | Controlador 1 | **Líder de Consenso:** coordena Quorum 2x1 pré-gravação |
| **3002** | gRPC | Controlador 2 | **Réplica Honesta:** vota com integridade e destino de Failover |
| **3003** | gRPC | Controlador 3 | **Réplica Bizantina:** simulação de dados corrompidos descartados |
| **3000** | HTTP / Next.js | Frontend Clínico | Dashboard dos terapeutas e Simulador Mobile dos alunos |
