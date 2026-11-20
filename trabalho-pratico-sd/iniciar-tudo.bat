@echo off
REM Configura a página de código do terminal para UTF-8 evitando caracteres corrompidos
chcp 65001 > nul
REM Imprime cabeçalho visual de inicialização
echo ==========================================================
REM Informa o nome do sistema em inicialização
echo Iniciando Sistema Completo Diverterapia IoT (SD)
REM Fecha o cabeçalho visual
echo ==========================================================

REM 1. Tenta subir os containers Docker (Mosquitto :1883 e MongoDB 1, 2 e 3) e inicia o Broker MQTT local em Node.js
echo Subindo Broker MQTT (:1883) e containers Docker (se disponivel)...
docker compose up -d 2>nul
start "Broker MQTT (:1883)" cmd /k "npm run broker"
REM Aguarda 2 segundos para inicialização completa do broker
timeout /t 2 /nobreak > nul

REM 2. Inicia os 3 Controladores gRPC em janelas independentes
start "Controlador 1 (:3001)" cmd /k "npm run ctrl1"
start "Controlador 2 (:3002)" cmd /k "npm run ctrl2"
start "Controlador 3 (:3003)" cmd /k "npm run ctrl3"
REM Aguarda 2 segundos para os controladores abrirem as portas gRPC
timeout /t 2 /nobreak > nul

REM 3. Inicia os 3 Atuadores MQTT em janelas independentes
start "Atuador Luz" cmd /k "npm run atuador:luz"
start "Atuador Speaker" cmd /k "npm run atuador:speaker"
start "Atuador Display" cmd /k "npm run atuador:display"

REM 4. Inicia os 3 Sensores MQTT (Publishers CLI) em janelas independentes
start "Sensor Ruido" cmd /k "npm run sensor:ruido"
start "Sensor BPM" cmd /k "npm run sensor:bpm"
start "Sensor Presenca" cmd /k "npm run sensor:presenca"

REM 5. Inicia o Frontend e API Gateway Next.js na porta 3000
start "Dashboard Next.js (:3000)" cmd /k "cd cliente-dashboard && npm run dev"

REM Exibe resumo final da inicialização da infraestrutura Docker e dos 10 processos
echo Infraestrutura Docker (Mosquitto + 3 MongoDBs) e todos os 10 processos iniciados!
REM Exibe o endereço web do painel clínico
echo Acesse: http://localhost:3000
