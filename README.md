# ⚡ JobHunter

Sistema completo de automação de busca e candidatura em vagas de emprego. Busca simultaneamente em **30+ plataformas** brasileiras e internacionais, deduplica resultados, calcula match com seu perfil via IA e aplica automaticamente nas vagas compatíveis.

---

## 🏗️ Arquitetura

```
jobhunter/
├── docker-compose.yml            # Orquestra backend + frontend
├── start.sh / start.bat          # Scripts de inicialização
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts              # Express server
│       ├── db.ts                 # SQLite via sql.js (sem compilação nativa)
│       ├── types.ts              # Tipos compartilhados
│       ├── dedup.ts              # Deduplicação por fingerprint + Jaccard
│       ├── queue.ts              # Semáforo de concorrência Playwright
│       ├── keyword_expander.ts   # Expansão de keywords (Ollama / Claude / local)
│       ├── mailer.ts             # Notificações por e-mail (Nodemailer)
│       ├── cron.ts               # Agendamentos automáticos (node-cron)
│       ├── routes/
│       │   └── index.ts          # Todos os endpoints REST
│       └── scrapers/
│           ├── gupy.ts           # API pública Gupy + white-labels
│           ├── gupy_apply.ts     # Gupy Easy Apply (sem login)
│           ├── inhire.ts         # API pública Inhire + white-labels
│           ├── geekhunter.ts     # API GeekHunter
│           ├── csod.ts           # Cornerstone OnDemand (Bradesco, Itaú...)
│           ├── remoteok.ts       # API pública RemoteOK
│           ├── weworkremotely.ts # RSS We Work Remotely
│           ├── vagas_br.ts       # Vagas.com.br + 99Jobs
│           ├── playwright.ts     # Glassdoor, Catho, InfoJobs + auto-apply
│           └── global_playwright.ts  # 15+ fontes via Playwright
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf                # Proxy /api → backend
│   └── index.html                # Dashboard completo (HTML/CSS/JS)
└── data/
    └── jobhunter.db              # SQLite gerado automaticamente
```

---

## 🚀 Como rodar

### Pré-requisitos
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado

### Linux / Mac
```bash
chmod +x start.sh && ./start.sh
```

### Windows
Duplo clique em `start.bat`

### Manual
```bash
docker compose up --build -d
```

Acesse: **http://localhost**

---

## 🔍 Fontes de busca (30+)

### 🇧🇷 Brasil — Tech
| Fonte | Estratégia |
|-------|-----------|
| **Gupy** | API REST pública + white-labels (DBC, Nava, Accenture...) |
| **Inhire** | API pública + white-labels (Contabilizei, Creditas...) |
| **GeekHunter** | API interna |
| **Programathor** | Playwright |
| **Hipsters.jobs** | Playwright |
| **Apinfo** | Playwright |
| **Revelo** | Playwright |
| **Otta** | Playwright |

### 🇧🇷 Brasil — Geral
| Fonte | Estratégia |
|-------|-----------|
| **Vagas.com.br** | API interna |
| **Catho** | Playwright + page.evaluate |
| **InfoJobs** | Playwright + page.evaluate |
| **99Jobs** | API interna |
| **Sólides Vagas** | Playwright |
| **BNE** | Playwright |
| **Empregos.com.br** | Playwright |
| **Trabalha Brasil** | Playwright |
| **Emprega Brasil (SINE)** | Playwright |
| **CIEE** | Playwright (estágio) |
| **Trovit** | Playwright (agregador) |
| **Corporativos (CSOD)** | API REST (Bradesco, Itaú, Ambev...) |

### 🌍 Global
| Fonte | Estratégia |
|-------|-----------|
| **Glassdoor** | Playwright + page.evaluate |
| **Indeed BR** | Playwright + page.evaluate |
| **Wellfound** | Playwright |
| **Jooble** | Playwright (agregador) |
| **Dice** | Playwright |
| **Built In** | Playwright |
| **ZipRecruiter** | Playwright |
| **Monster** | Playwright |

### 🏠 Remoto & Freelance
| Fonte | Estratégia |
|-------|-----------|
| **RemoteOK** | API JSON pública oficial |
| **We Work Remotely** | RSS feed oficial |
| **Remotar** | Playwright |
| **Workana** | Playwright (freelance) |

---

## 📡 Endpoints da API

### Vagas
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/stats` | Estatísticas gerais |
| `GET` | `/api/jobs` | Listar vagas (`?source=gupy&search=java&limit=50`) |
| `GET` | `/api/jobs/:id` | Detalhes de uma vaga |
| `PATCH` | `/api/jobs/:id/status` | Atualizar status (new/saved/ignored) |
| `DELETE` | `/api/jobs/source/:source` | Limpar vagas de uma fonte |
| `DELETE` | `/api/jobs/all` | Limpar todas as vagas |

### Scraping
| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/scrape/stream` | Busca com progresso SSE em tempo real |
| `POST` | `/api/scrape` | Busca sem streaming (legado) |
| `POST` | `/api/expand-keywords` | Expandir keywords via Ollama/Claude/local |
| `GET` | `/api/ollama-status` | Verificar status do Ollama |

### Candidaturas
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/applications` | Listar candidaturas (Kanban) |
| `POST` | `/api/applications` | Criar candidatura manual |
| `PATCH` | `/api/applications/:id` | Atualizar status |
| `POST` | `/api/apply/:jobId` | Auto-aplicar (Gupy Easy Apply ou Playwright) |

### Agendamentos
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/schedules` | Listar agendamentos |
| `POST` | `/api/schedules` | Criar agendamento (cron) |
| `PATCH` | `/api/schedules/:id` | Ativar/pausar |
| `DELETE` | `/api/schedules/:id` | Excluir |
| `POST` | `/api/schedules/:id/run` | Executar agora |

### Perfil
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/profile` | Obter perfil |
| `PUT` | `/api/profile` | Salvar perfil |

---

## 🤖 Expansão de Keywords com IA

Antes de buscar, o sistema expande automaticamente suas keywords em variações otimizadas para cobrir diferentes títulos de vagas:

**`"desenvolvedor java pleno"`** → `["java developer", "engenheiro backend java", "spring boot developer", "dev java pleno", ...]`

### Ordem de prioridade:
1. **🦙 Ollama** (local, gratuito) — recomendado
2. **🤖 Claude API** (pago, ~$0.0002/busca) — se `ANTHROPIC_API_KEY` configurada
3. **📚 Dicionário local** — sempre disponível como fallback

### Instalar Ollama (recomendado):
```bash
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.2
```

---

## ⚡ Gupy Easy Apply

Para vagas Gupy com "Candidatura Simplificada", o sistema envia a candidatura diretamente via API — sem abrir browser, sem login.

**Fluxo:**
1. Detecta se a vaga suporta Easy Apply
2. Envia `FormData` com nome, email, telefone, LinkedIn e CV (PDF)
3. Registra a candidatura no dashboard com o ID retornado

---

## ⏰ Agendamentos Automáticos

Configure buscas automáticas com notificação por e-mail:

```
Dashboard → ⏰ Agendamentos → + Novo Agendamento
```

Exemplos de cron:
- `0 8 * * 1-5` — dias úteis às 8h
- `0 8,18 * * *` — 2x por dia
- `0 8 * * 1` — toda segunda-feira

---

## 📦 Variáveis de ambiente (`.env`)

```env
# Servidor
PORT=3001
DB_PATH=/data/jobhunter.db
FRONTEND_URL=http://localhost

# Playwright
HEADLESS=true
PLAYWRIGHT_CONCURRENCY=3        # auto-tunado por CPU/RAM se omitido

# Ollama (expansão de keywords)
OLLAMA_HOST=http://host.docker.internal:11434
OLLAMA_MODEL=llama3.2

# Claude API (opcional, fallback do Ollama)
ANTHROPIC_API_KEY=sk-ant-...

# E-mail (opcional, para alertas de novas vagas)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu@gmail.com
SMTP_PASS=sua_senha_de_app
NOTIFY_EMAIL=seu@gmail.com

# Cron padrão via env (opcional)
DEFAULT_CRON=0 8 * * 1-5
DEFAULT_KEYWORDS=desenvolvedor java,spring boot,backend
DEFAULT_SOURCES=gupy,inhire,geekhunter,remoteok
```

---

## 🛡️ Observações

- Playwright usa `networkidle` + `page.evaluate()` para capturar URLs corretas após renderização JS
- Deduplicação por fingerprint (normalização + Jaccard) evita duplicatas entre fontes
- Semáforo de concorrência evita OOM — auto-tunado pelo número de CPUs e RAM disponível
- Respeite os Termos de Serviço de cada plataforma
