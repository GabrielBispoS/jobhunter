import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { Job, ScraperResult, SearchConfig } from '../types';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: process.env['HEADLESS'] !== 'false',
      executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) { await browser.close(); browser = null; }
}

async function newCtx(overrides: object = {}): Promise<BrowserContext> {
  const b = await getBrowser();
  return b.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'pt-BR',
    viewport: { width: 1280, height: 800 },
    ...overrides,
  });
}

// ── shared helpers ─────────────────────────────────────────────────────────────

function toB64id(a: string, b: string): string {
  return Buffer.from(`${a}-${b}`).toString('base64').slice(0, 16);
}

async function getText(page: Page | any, sel: string): Promise<string | undefined> {
  return page.$eval(sel, (el: Element) => el.textContent?.trim()).catch(() => undefined);
}

async function getHref(page: Page | any, sel: string): Promise<string | undefined> {
  return page.$eval(sel, (el: Element) => (el as HTMLAnchorElement).href).catch(() => undefined);
}

async function closePopups(page: Page): Promise<void> {
  for (const sel of ['[data-test="modal-close-btn"]', 'button[aria-label="Fechar"]', 'button[aria-label="Close"]', '.modal-close', '[class*="CloseButton"]']) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) { await btn.click().catch(() => {}); await page.waitForTimeout(300); }
  }
}

async function stealthPage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    (window as any).chrome = { runtime: {} };
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Glassdoor ─────────────────────────────────────────────────────────────────

export async function scrapeGlassdoor(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now();
  const jobs: Job[] = [];
  const errors: string[] = [];
  try {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    await stealthPage(page);
    const keyword = config.keywords.join(' ');
    const url = `https://www.glassdoor.com.br/Vaga/${encodeURIComponent(keyword)}-vagas-SRCH_KO0,${keyword.length}.htm?sc.keyword=${encodeURIComponent(keyword)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await closePopups(page);
    const cards = await page.$$('[data-test="jobListing"], .jobsList li, [class*="JobCard"]');
    for (const card of cards.slice(0, 30)) {
      try {
        const title = await getText(card, '[data-test="job-title"], .jobTitle, [class*="jobTitle"]') ?? 'N/A';
        const company = await getText(card, '[data-test="employer-name"], .employerName, [class*="EmployerName"]') ?? 'N/A';
        const location = await getText(card, '[data-test="location"], .location, [class*="location"]');
        const link = await getHref(card, 'a[href*="/Vaga/"]');
        const salary = await getText(card, '[data-test="detailSalary"], [class*="salary"]');
        if (title !== 'N/A') {
          jobs.push({ id: `glassdoor-${toB64id(title, company)}`, title, company, location, salary, url: link || url, apply_url: link, source: 'glassdoor', fetched_at: new Date().toISOString(), tags: [] });
        }
      } catch { /* skip */ }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Glassdoor: ${err.message}`); }
  return { jobs, errors, source: 'glassdoor', duration_ms: Date.now() - start };
}

// ── Catho ─────────────────────────────────────────────────────────────────────

export async function scrapeCatho(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now();
  const jobs: Job[] = [];
  const errors: string[] = [];
  try {
    const ctx = await newCtx({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
    const page = await ctx.newPage();
    await stealthPage(page);
    const keyword = config.keywords.join(' ');
    const cathoUrl = `https://www.catho.com.br/vagas/${encodeURIComponent(keyword.replace(/\s+/g, '-'))}/`;
    await page.goto(cathoUrl, { waitUntil: 'networkidle', timeout: 35000 });
    await page.waitForTimeout(2000);

    const extracted = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[class*="card"]:has(h2), [data-id], article[class*="Job"], li[class*="Job"]'));
      return cards.slice(0, 30).map(card => {
        const title = card.querySelector('h2, h3, [class*="title"]')?.textContent?.trim() || 'N/A';
        const company = card.querySelector('[class*="company"], [class*="employer"]')?.textContent?.trim() || 'N/A';
        const location = card.querySelector('[class*="location"], [class*="city"]')?.textContent?.trim() || '';
        const salary = card.querySelector('[class*="salary"], [class*="wage"]')?.textContent?.trim() || '';
        const anchor = card.querySelector('a[href*="/vagas/"]') as HTMLAnchorElement | null;
        const url = anchor?.href || '';
        return { title, company, location, salary, url };
      });
    });

    for (const item of extracted) {
      if (item.title !== 'N/A' && item.url && !item.url.endsWith('catho.com.br/')) {
        jobs.push({ id: `catho-${toB64id(item.title, item.company)}`, title: item.title, company: item.company, location: item.location || undefined, salary: item.salary || undefined, url: item.url, apply_url: item.url, source: 'catho', fetched_at: new Date().toISOString(), tags: [] });
      }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Catho: ${err.message}`); }
  return { jobs, errors, source: 'catho', duration_ms: Date.now() - start };
}

// ── InfoJobs ──────────────────────────────────────────────────────────────────

export async function scrapeInfoJobs(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now();
  const jobs: Job[] = [];
  const errors: string[] = [];
  try {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    await stealthPage(page);
    const keyword = config.keywords.join(' ');
    const infojobsUrl = `https://www.infojobs.com.br/empregos.aspx?palabra=${encodeURIComponent(keyword)}`;
    await page.goto(infojobsUrl, { waitUntil: 'networkidle', timeout: 35000 });
    await page.waitForTimeout(2000);

    const extracted = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.offer-item, [class*="offer"], article.ij-offersearch'));
      return cards.slice(0, 30).map(card => {
        const titleAnchor = card.querySelector('h2 a, h3 a, .title-link') as HTMLAnchorElement | null;
        const title = titleAnchor?.textContent?.trim() || 'N/A';
        const url = titleAnchor?.href || '';
        const company = card.querySelector('[class*="company"], .company-name')?.textContent?.trim() || 'N/A';
        const location = card.querySelector('[class*="location"], .location')?.textContent?.trim() || '';
        const salary = card.querySelector('[class*="salary"]')?.textContent?.trim() || '';
        return { title, company, location, salary, url };
      });
    });

    for (const item of extracted) {
      if (item.title !== 'N/A' && item.url && !item.url.endsWith('infojobs.com.br/')) {
        jobs.push({ id: `infojobs-${toB64id(item.title, item.company)}`, title: item.title, company: item.company, location: item.location || undefined, salary: item.salary || undefined, url: item.url, apply_url: item.url, source: 'infojobs' as any, fetched_at: new Date().toISOString(), tags: [] });
      }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`InfoJobs: ${err.message}`); }
  return { jobs, errors, source: 'infojobs', duration_ms: Date.now() - start };
}

// ── Auto-apply ────────────────────────────────────────────────────────────────

export interface ApplyConfig {
  applyUrl: string;
  profile: { name: string; email: string; phone: string; linkedin?: string; resume_path?: string };
  answers?: Record<string, string>;
}

export interface ApplyResult { success: boolean; message: string; screenshot?: string; }

export async function autoApply(config: ApplyConfig): Promise<ApplyResult> {
  const ctx = await newCtx();
  const page = await ctx.newPage();
  try {
    await page.goto(config.applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    await fill(page, ['name', 'nome', 'full name', 'nome completo'], config.profile.name);
    await fill(page, ['email', 'e-mail', 'email address'], config.profile.email);
    await fill(page, ['phone', 'telefone', 'celular', 'mobile', 'whatsapp'], config.profile.phone);
    if (config.profile.linkedin) await fill(page, ['linkedin'], config.profile.linkedin);
    if (config.profile.resume_path) {
      const fi = await page.$('input[type="file"]');
      if (fi) { await fi.setInputFiles(config.profile.resume_path); await sleep(1000); }
    }
    if (config.answers) {
      for (const [q, a] of Object.entries(config.answers)) await fill(page, [q.toLowerCase()], a);
    }
    const buf = await page.screenshot({ fullPage: false });
    const screenshot = buf.toString('base64');
    const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Candidatar"), button:has-text("Apply"), button:has-text("Enviar")');
    await ctx.close();
    if (!submitBtn) return { success: false, message: 'Botão de envio não encontrado.', screenshot };
    return { success: true, message: 'Formulário preenchido. Pronto para enviar.', screenshot };
  } catch (err: any) {
    const buf = await page.screenshot().catch(() => null);
    await ctx.close();
    return { success: false, message: `Erro: ${err.message}`, screenshot: buf ? buf.toString('base64') : undefined };
  }
}

async function fill(page: Page, labels: string[], value: string): Promise<void> {
  if (!value) return;
  for (const label of labels) {
    for (const selector of [
      `input[aria-label*="${label}" i]`,
      `textarea[aria-label*="${label}" i]`,
      `input[placeholder*="${label}" i]`,
      `textarea[placeholder*="${label}" i]`,
      `input[name*="${label}" i]`,
      `textarea[name*="${label}" i]`,
    ]) {
      const el = await page.$(selector).catch(() => null);
      if (el) { await el.fill(value); return; }
    }
    const labelEl = await page.$(`label:has-text("${label}")`).catch(() => null);
    if (labelEl) {
      const forAttr = await labelEl.getAttribute('for');
      if (forAttr) { const input = await page.$(`#${forAttr}`).catch(() => null); if (input) { await input.fill(value); return; } }
    }
  }
}
