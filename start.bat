@echo off
echo.
echo ⚡ JobHunter — Docker Setup
echo ────────────────────────────

docker --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo ❌ Docker nao encontrado. Instale em: https://docs.docker.com/get-docker/
    pause
    exit /b 1
)

echo ✅ Docker encontrado
echo.
echo 🔨 Fazendo build das imagens...
docker compose build

echo.
echo 🚀 Subindo containers...
docker compose up -d

echo.
echo ────────────────────────────────────────
echo ✅ JobHunter rodando!
echo.
echo   Dashboard:  http://localhost
echo   API:        http://localhost/api
echo.
echo   Para parar: docker compose down
echo   Para logs:  docker compose logs -f
echo ────────────────────────────────────────
pause
