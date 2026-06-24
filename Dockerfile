# ── Stage 1: Build TypeScript ─────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /build

COPY backend/package.json ./
RUN npm install

COPY backend/tsconfig.json ./
COPY backend/src/ ./src/

RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

WORKDIR /app/backend

# Install production Node dependencies
COPY backend/package.json ./
RUN npm install --omit=dev

# Install Playwright Chromium + all required system packages
# --with-deps handles apt-get automatically for the current OS
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN npx playwright install chromium --with-deps \
    && rm -rf /tmp/* ~/.npm

# Compiled TypeScript
COPY --from=builder /build/dist ./dist

# Frontend served statically by Express (path.join(__dirname, '../../frontend'))
COPY frontend/ /app/frontend/

# Data directory — mount a Railway Volume here for persistence
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/jobhunter.db
ENV HEADLESS=true
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

EXPOSE 3001

CMD ["node", "dist/index.js"]
