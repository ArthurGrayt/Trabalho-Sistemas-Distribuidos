@echo off
chcp 65001 > nul
echo ==========================================================
echo Iniciando Sistema Completo Diverterapia IoT (SD)
echo ==========================================================

REM 1. Broker MQTT
start "Broker MQTT (:1883)" cmd /k "npm run broker"
timeout /t 2 /nobreak > nul

REM 2. Controladores
start "Controlador 1 (:3001)" cmd /k "npm run ctrl1"
start "Controlador 2 (:3002)" cmd /k "npm run ctrl2"
start "Controlador 3 (:3003)" cmd /k "npm run ctrl3"
timeout /t 2 /nobreak > nul

REM 3. Atuadores
start "Atuador Luz" cmd /k "npm run atuador:luz"
start "Atuador Speaker" cmd /k "npm run atuador:speaker"
start "Atuador Display" cmd /k "npm run atuador:display"

REM 4. Sensores
start "Sensor Ruido" cmd /k "npm run sensor:ruido"
start "Sensor BPM" cmd /k "npm run sensor:bpm"
start "Sensor Presenca" cmd /k "npm run sensor:presenca"

REM 5. Frontend Next.js
start "Dashboard Next.js (:3000)" cmd /k "cd cliente-dashboard && npm run dev"

echo Todos os servicos foram iniciados em janelas separadas!
echo Acesse: http://localhost:3000

