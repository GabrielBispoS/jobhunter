#!/bin/bash
# ── JobHunter startup script ──────────────────────────────────────────────────
set -e

echo ""
echo "⚡ JobHunter — Docker Setup"
echo "────────────────────────────"

# Check Docker
if ! command -v docker &> /dev/null; then
  echo "❌ Docker não encontrado. Instale em: https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker compose version &> /dev/null 2>&1; then
  echo "❌ Docker Compose não encontrado. Atualize o Docker Desktop."
  exit 1
fi

echo "✅ Docker encontrado: $(docker --version)"

# Build and start
echo ""
echo "🔨 Fazendo build das imagens..."
docker compose build

echo ""
echo "🚀 Subindo containers..."
docker compose up -d

echo ""
echo "⏳ Aguardando backend ficar saudável..."
for i in $(seq 1 20); do
  if docker compose ps backend | grep -q "healthy"; then
    break
  fi
  sleep 2
  echo -n "."
done

echo ""
echo ""
echo "────────────────────────────────────────"
echo "✅ JobHunter rodando!"
echo ""
echo "  🌐 Dashboard:  http://localhost"
echo "  🔌 API:        http://localhost/api"
echo "  📊 Health:     http://localhost/api/../health"
echo ""
echo "  Para parar:    docker compose down"
echo "  Para logs:     docker compose logs -f"
echo "────────────────────────────────────────"
