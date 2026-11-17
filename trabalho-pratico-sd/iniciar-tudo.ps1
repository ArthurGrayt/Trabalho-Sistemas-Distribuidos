Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Iniciando Sistema Completo Diverterapia IoT (SD)" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Inicia Broker MQTT em uma janela
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run broker"

# Aguarda 2 segundos para o Broker subir
Start-Sleep -Seconds 2

# 2. Inicia os 3 Controladores
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run ctrl1"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run ctrl2"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run ctrl3"

# Aguarda 2 segundos para os controladores conectarem
Start-Sleep -Seconds 2

# 3. Inicia os 3 Atuadores
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run atuador:luz"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run atuador:speaker"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run atuador:display"

# 4. Inicia os 3 Sensores
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run sensor:ruido"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run sensor:bpm"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run sensor:presenca"

# 5. Inicia o Frontend Next.js
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd cliente-dashboard; npm run dev"

Write-Host "Todos os 11 processos foram iniciados com sucesso!" -ForegroundColor Green
Write-Host "Acesse o painel em: http://localhost:3000" -ForegroundColor Cyan

