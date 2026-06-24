@echo off
echo.
echo ⚡ JobHunter — Dev Mode (sem Docker)
echo ──────────────────────────────────────

set NODE_PATH=C:\Users\gabriel.fernando\AppData\Local\OpenAI\Codex\runtimes\cua_node\2f053e67fec2d258\bin
set PATH=%NODE_PATH%;%PATH%

:: Verifica se node existe
where node >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js nao encontrado em: %NODE_PATH%
    echo    Instale Node.js em: https://nodejs.org
    pause
    exit /b 1
)

echo ✅ Node.js encontrado

:: Instala dependencias se necessario
IF NOT EXIST "backend\node_modules" (
    echo 📦 Instalando dependencias...
    cd backend && npm install && cd ..
)

echo.
echo 🚀 Iniciando backend na porta 3001...
echo    Dashboard: http://localhost:3001
echo    API:       http://localhost:3001/api
echo    Health:    http://localhost:3001/health
echo.
echo    Pressione Ctrl+C para parar
echo ──────────────────────────────────────
echo.

cd backend && npm run dev
