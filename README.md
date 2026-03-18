# ⚡ JobHunter

Sistema de automação de candidaturas em vagas de emprego. Busca, filtra e aplica automaticamente nas principais plataformas brasileiras.

## 🏗️ Arquitetura

```
jobhunter/
├── backend/                  # API Node.js + TypeScript
│   └── src/
│       ├── index.ts          # Express server
│       ├── db.ts             # SQLite (better-sqlite3)
│       ├── types.ts          # Tipos compartilhados
│       ├── routes/
│       │   └── index.ts      # Todos os endpoints REST
│       └── scrapers/
│           ├── gupy.ts       # API REST pública do portal.gupy.io
│           ├── inhire.ts     # API pública Inhire
│           └── playwright.ts # Glassdoor, Catho, InfoJobs + auto-apply
├── frontend/
│   └── index.html            # Dashboard completo (HTML/CSS/JS)
└── data/
    └── jobhunter.db          # SQLite (gerado automaticamente)
```

## 🚀 Como rodar

### Backend

```bash
cd backend
npm install
npx playwright install chromium   # só na primeira vez
npm run dev
```

API rodando em: `http://localhost:3001`

### Frontend

Abra `frontend/index.html` no browser — funciona como arquivo estático.  
Ou sirva com: `npx serve frontend/`

---

## 📡 Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/stats` | Estatísticas gerais |
| `GET` | `/api/jobs` | Listar vagas (`?source=gupy&search=react&limit=50`) |
| `GET` | `/api/jobs/:id` | Detalhes de uma vaga |
| `PATCH` | `/api/jobs/:id/status` | Atualizar status (new/saved/ignored) |
| `POST` | `/api/scrape` | Disparar busca de vagas |
| `GET` | `/api/applications` | Listar candidaturas |
| `POST` | `/api/applications` | Criar candidatura manual |
| `PATCH` | `/api/applications/:id` | Atualizar candidatura |
| `POST` | `/api/apply/:jobId` | Auto-aplicar via Playwright |
| `GET` | `/api/profile` | Obter perfil do usuário |
| `PUT` | `/api/profile` | Salvar perfil |

---

## 🔍 Scrape: payload de exemplo

```bash
curl -X POST http://localhost:3001/api/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": ["desenvolvedor react", "full stack", "frontend"],
    "location": "Uberlândia",
    "remote_only": false,
    "sources": ["gupy", "inhire", "glassdoor"]
  }'
```

---

## 🤖 Fontes e estratégia

| Plataforma | Estratégia | Notas |
|------------|------------|-------|
| **Gupy** | API REST pública `portal.gupy.io/api/search/v1` | Sem auth necessária |
| **Inhire** | API pública documentada | Paginação por `exclusiveStartKey` |
| **Glassdoor** | Playwright (headless Chromium) | Requer user-agent + stealth |
| **Catho** | Playwright | Conteúdo dinâmico JS |
| **InfoJobs** | Playwright | HTML server-side + JS |

---

## 🚀 Auto-Apply (Playwright)

O sistema preenche formulários automaticamente mas **NÃO submete sem confirmação humana**.

Fluxo:
1. Abre a URL de candidatura no browser headless
2. Preenche campos (nome, email, telefone, LinkedIn, CV)  
3. Tira uma screenshot do formulário preenchido
4. Retorna a screenshot para revisão
5. Você confirma → sistema clica em enviar

Para candidaturas Gupy com `quickApply`, o preenchimento é ainda mais simples (4 campos apenas).

---

## 🛡️ Avisos

- Glassdoor e Catho podem detectar bots eventualmente — use delays generosos
- Configure `USER_AGENT` e `HEADLESS=false` para debug visual
- Respeite os ToS de cada plataforma

---

## 📦 Variáveis de ambiente (`.env`)

```env
PORT=3001
DB_PATH=./data/jobhunter.db
FRONTEND_URL=http://localhost:5173
HEADLESS=true           # false para ver o browser na tela
SCRAPE_DELAY_MS=800     # delay entre requests
```

---

## 🗺️ Roadmap

- [ ] Agendamento automático de buscas (cron)
- [ ] Notificações por e-mail / WhatsApp
- [ ] Integração com Claude API para gerar cover letters
- [ ] Export para CSV/Notion
- [ ] Sites próprios de empresas (Nubank, iFood, etc.)
