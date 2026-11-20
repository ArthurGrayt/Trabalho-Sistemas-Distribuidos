# Exibe cabeçalho informativo no terminal PowerShell
Write-Host "==========================================================" -ForegroundColor Cyan
# Exibe o nome do sistema que está sendo inicializado
Write-Host "Iniciando Sistema Completo Diverterapia IoT (SD)" -ForegroundColor Yellow
# Exibe linha divisória de fechamento do cabeçalho
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Tenta subir a infraestrutura Docker se o Docker estiver instalado; caso contrário usa o Broker MQTT local em Node.js
Write-Host "Verificando containers Docker (Eclipse Mosquitto e MongoDB 1/2/3)..." -ForegroundColor Cyan
if (Get-Command docker -ErrorAction SilentlyContinue) {
  # Executa o Docker Compose em modo detached para manter os serviços ativos
  docker compose up -d
}
# Inicia o Broker MQTT Node.js local na porta 1883 (atua automaticamente se o container Mosquitto não estiver rodando)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run broker"

# Aguarda 2 segundos para garantir que o Broker MQTT esteja aceitando conexões
Start-Sleep -Seconds 2

# 2. Inicia os 3 Controladores gRPC em janelas separadas para visualização didática
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run ctrl1"
# Inicia o Controlador 2 (Réplica Honesta / Líder Interino)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run ctrl2"
# Inicia o Controlador 3 (Réplica Bizantina Toggleável)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run ctrl3"

# Aguarda 2 segundos para os controladores inicializarem suas conexões e servidores gRPC
Start-Sleep -Seconds 2

# 3. Inicia os 3 Atuadores MQTT em janelas separadas
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run atuador:luz"
# Inicia o atuador Smart Speaker
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run atuador:speaker"
# Inicia o atuador Display de Porta
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run atuador:display"

# 4. Inicia os 3 Sensores MQTT (Publishers CLI) em janelas separadas
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run sensor:ruido"
# Inicia o sensor de batimentos cardíacos
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run sensor:bpm"
# Inicia o sensor de presença na porta
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run sensor:presenca"

# 5. Inicia o Frontend e API Gateway Next.js na porta 3000
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd cliente-dashboard; npm run dev"

# Confirma que a infraestrutura Docker e todos os 10 processos Node.js foram iniciados
Write-Host "Infraestrutura Docker (Mosquitto + 3 MongoDBs) e todos os 10 processos iniciados com sucesso!" -ForegroundColor Green
# Exibe a URL de acesso ao painel clínico
Write-Host "Acesse o painel em: http://localhost:3000" -ForegroundColor Cyan
