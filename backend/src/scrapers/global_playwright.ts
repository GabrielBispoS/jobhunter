import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { Job, ScraperResult, SearchConfig } from '../types';

// ── Playwright-based scrapers for platforms without public APIs ───────────────
// Covers: Programathor, Wellfound, Dice, Built In, Monster, ZipRecruiter,
//         Remotar, Hipsters.jobs, Apinfo, Indeed BR, Revelo, Trabalha Brasil

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

async function newCtx(ua?: string): Promise<BrowserContext> {
  const b = await getBrowser();
  return b.newContext({
    userAgent: ua || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'pt-BR',
    viewport: { width: 1280, height: 800 },
  });
}

async function stealth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    (window as any).chrome = { runtime: {} };
  });
}

function b64id(a: string, b: string): string {
  return Buffer.from(`${a}-${b}`).toString('base64').slice(0, 16);
}

async function txt(el: any, sel: string): Promise<string | undefined> {
  return el.$eval(sel, (e: Element) => e.textContent?.trim()).catch(() => undefined);
}

async function href(el: any, sel: string): Promise<string | undefined> {
  return el.$eval(sel, (e: Element) => (e as HTMLAnchorElement).href).catch(() => undefined);
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// Validate a URL is a real job page, not a homepage/root
function isValidJobUrl(url: string, baseDomain: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const path = u.pathname;
    // Reject root paths, empty paths, or paths that are just the domain
    if (path === '/' || path === '' || path.length < 4) return false;
    // Reject if URL is exactly the base domain
    if (url.replace(/\/+$/, '') === baseDomain.replace(/\/+$/, '')) return false;
    return true;
  } catch { return false; }
}

// ── Programathor ──────────────────────────────────────────────────────────────
export async function scrapeProgramathor(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const keyword = config.keywords.join('-').toLowerCase().replace(/\s+/g, '-');
    await page.goto(`https://programathor.com.br/jobs-${keyword}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const cards = await page.$$('.cell-list-developer-job, article[class*="job"], .job-item');
    for (const card of cards.slice(0, 30)) {
      try {
        const title = await txt(card, 'h2, h3, [class*="title"]') ?? 'N/A';
        const company = await txt(card, '[class*="company"], [class*="employer"]') ?? 'N/A';
        const location = await txt(card, '[class*="location"], [class*="city"]');
        const link = await href(card, 'a');
        if (title !== 'N/A' && isValidJobUrl(link || '', 'https://programathor.com.br')) jobs.push({ id: `programathor-${b64id(title,company)}`, title, company, location, remote: location?.toLowerCase().includes('remoto') ? 'remote' : undefined, url: link!, apply_url: link, source: 'programathor' as any, fetched_at: new Date().toISOString(), tags: ['tech'] });
      } catch { /* skip */ }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Programathor: ${err.message}`); }
  return { jobs, errors, source: 'programathor', duration_ms: Date.now() - start };
}

// ── Hipsters.jobs ─────────────────────────────────────────────────────────────
export async function scrapeHipsters(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    await page.goto('https://hipsters.jobs/vagas/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    const keyword = config.keywords.map(k => k.toLowerCase());
    const extracted = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('article, .job-post, [class*="vaga"], li.job'));
      return cards.slice(0, 50).map(card => ({
        title: card.querySelector('h2, h3, .title, [class*="title"]')?.textContent?.trim() || 'N/A',
        company: card.querySelector('[class*="company"], [class*="employer"]')?.textContent?.trim() || 'N/A',
        url: (card.querySelector('a') as HTMLAnchorElement)?.href || '',
      }));
    });
    for (const item of extracted) {
      if (item.title === 'N/A' || !isValidJobUrl(item.url, 'https://hipsters.jobs')) continue;
      const text = `${item.title} ${item.company}`.toLowerCase();
      if (keyword.length && !keyword.some(k => text.includes(k))) continue;
      jobs.push({ id: `hipsters-${b64id(item.title, item.company)}`, title: item.title, company: item.company, remote: 'remote', url: item.url, apply_url: item.url, source: 'hipsters' as any, fetched_at: new Date().toISOString(), tags: ['tech','remote'] });
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Hipsters.jobs: ${err.message}`); }
  return { jobs, errors, source: 'hipsters', duration_ms: Date.now() - start };
}

// ── Apinfo ────────────────────────────────────────────────────────────────────
export async function scrapeApinfo(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const keyword = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://www.apinfo.com/apinfo/apinfo.cfm?u=listar&campo=${keyword}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    const cards = await page.$$('table tr:has(td), .vaga, [class*="job"]');
    for (const card of cards.slice(0, 40)) {
      try {
        const title = await txt(card, 'td:first-child, h3, [class*="title"]') ?? 'N/A';
        const link = await href(card, 'a');
        const company = await txt(card, 'td:nth-child(2)') ?? 'N/A';
        if (title !== 'N/A' && title.length > 3) {
          jobs.push({ id: `apinfo-${b64id(title,company)}`, title, company, url: link || 'https://www.apinfo.com', apply_url: link, source: 'apinfo' as any, fetched_at: new Date().toISOString(), tags: [] });
        }
      } catch { /* skip */ }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Apinfo: ${err.message}`); }
  return { jobs, errors, source: 'apinfo', duration_ms: Date.now() - start };
}

// ── Remotar ───────────────────────────────────────────────────────────────────
export async function scrapeRemotar(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const keyword = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://remotar.com.br/search/jobs?q=${keyword}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const cards = await page.$$('[class*="job-card"], article, [class*="vaga"], .job');
    for (const card of cards.slice(0, 30)) {
      try {
        const title = await txt(card, 'h2, h3, [class*="title"]') ?? 'N/A';
        const company = await txt(card, '[class*="company"]') ?? 'N/A';
        const link = await href(card, 'a');
        if (title !== 'N/A' && isValidJobUrl(link || '', 'https://remotar.com.br')) jobs.push({ id: `remotar-${b64id(title,company)}`, title, company, remote: 'remote', location: 'Remoto', url: link!, apply_url: link, source: 'remotar' as any, fetched_at: new Date().toISOString(), tags: ['remote'] });
      } catch { /* skip */ }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Remotar: ${err.message}`); }
  return { jobs, errors, source: 'remotar', duration_ms: Date.now() - start };
}

// ── Trabalha Brasil ───────────────────────────────────────────────────────────
export async function scrapeTrabalha(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const keyword = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://www.trabalhabrasil.com.br/vagas-empregos-em/${keyword}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const cards = await page.$$('[class*="job"], article, .oportunidade');
    for (const card of cards.slice(0, 30)) {
      try {
        const title = await txt(card, 'h2, h3, [class*="title"]') ?? 'N/A';
        const company = await txt(card, '[class*="company"], [class*="empresa"]') ?? 'N/A';
        const location = await txt(card, '[class*="location"], [class*="cidade"]');
        const link = await href(card, 'a');
        if (title !== 'N/A' && isValidJobUrl(link || '', 'https://www.trabalhabrasil.com.br')) jobs.push({ id: `trabalha-${b64id(title,company)}`, title, company, location, url: link!, apply_url: link, source: 'trabalha_brasil' as any, fetched_at: new Date().toISOString(), tags: [] });
      } catch { /* skip */ }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Trabalha Brasil: ${err.message}`); }
  return { jobs, errors, source: 'trabalha_brasil', duration_ms: Date.now() - start };
}

// ── Wellfound (formerly AngelList) ────────────────────────────────────────────
export async function scrapeWellfound(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const keyword = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://wellfound.com/jobs?q=${keyword}&remote=true`, { waitUntil: 'networkidle', timeout: 35000 });
    await page.waitForTimeout(3000);
    await page.waitForSelector('[class*="JobCard"], [data-test*="job"]', { timeout: 10000 }).catch(() => {});
    const extracted = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[class*="JobCard"], [data-test*="job-listing"], article[class*="job"]'));
      return cards.slice(0, 30).map(card => ({
        title: card.querySelector('[class*="title"], h2, h3')?.textContent?.trim() || 'N/A',
        company: card.querySelector('[class*="company"], [class*="startup"]')?.textContent?.trim() || 'N/A',
        location: card.querySelector('[class*="location"]')?.textContent?.trim() || '',
        url: (card.querySelector('a') as HTMLAnchorElement)?.href || '',
      }));
    });
    for (const item of extracted) {
      if (item.title !== 'N/A' && isValidJobUrl(item.url, 'https://wellfound.com')) {
        jobs.push({ id: `wellfound-${b64id(item.title, item.company)}`, title: item.title, company: item.company, location: item.location || undefined, remote: item.location?.toLowerCase().includes('remote') ? 'remote' : undefined, url: item.url, apply_url: item.url, source: 'wellfound' as any, fetched_at: new Date().toISOString(), tags: ['startup'] });
      }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Wellfound: ${err.message}`); }
  return { jobs, errors, source: 'wellfound', duration_ms: Date.now() - start };
}

// ── Indeed BR ─────────────────────────────────────────────────────────────────
export async function scrapeIndeed(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const q = encodeURIComponent(config.keywords.join(' '));
    const l = encodeURIComponent(config.location || '');

    await page.goto(`https://br.indeed.com/jobs?q=${q}&l=${l}`, { waitUntil: 'networkidle', timeout: 35000 });

    // Wait for job cards to be fully rendered with their links
    await page.waitForSelector('[data-jk]', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Extract job data directly from the DOM using page.evaluate
    // This runs inside the browser context where JS has already resolved all hrefs
    const extracted = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-jk]'));
      return cards.slice(0, 30).map(card => {
        const jk = card.getAttribute('data-jk') || '';

        // Title anchor — Indeed renders it as <h2><a>title</a></h2>
        const titleEl = card.querySelector('h2 a, [class*="JobTitle"] a, a[id*="job_"]');
        const title = titleEl?.textContent?.trim() || 'N/A';

        // Get the actual href — by this point JS has resolved it
        const rawHref = (titleEl as HTMLAnchorElement)?.href || '';

        const company = card.querySelector('[data-testid="company-name"], [class*="companyName"]')?.textContent?.trim() || 'N/A';
        const location = card.querySelector('[data-testid="text-location"], [class*="companyLocation"]')?.textContent?.trim() || '';
        const salary = card.querySelector('[class*="salary"], [data-testid="attribute_snippet_testid"]')?.textContent?.trim() || '';

        // Build best possible URL
        let url = '';
        if (rawHref && rawHref !== window.location.href && !rawHref.endsWith('indeed.com/')) {
          url = rawHref;
        } else if (jk) {
          url = `https://br.indeed.com/viewjob?jk=${jk}`;
        }

        return { jk, title, company, location, salary, url };
      });
    });

    for (const item of extracted) {
      if (item.title === 'N/A' || !item.url) continue;
      jobs.push({
        id: `indeed-${item.jk || b64id(item.title, item.company)}`,
        title: item.title,
        company: item.company,
        location: item.location || undefined,
        salary: item.salary || undefined,
        url: item.url,
        apply_url: item.url,
        source: 'indeed' as any,
        fetched_at: new Date().toISOString(),
        tags: [],
      });
    }

    await ctx.close();
  } catch (err: any) { errors.push(`Indeed: ${err.message}`); }
  return { jobs, errors, source: 'indeed', duration_ms: Date.now() - start };
}

// ── Dice ──────────────────────────────────────────────────────────────────────
export async function scrapeDice(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const q = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://www.dice.com/jobs?q=${q}&location=Remote&radius=30&radiusUnit=mi&page=1&pageSize=20&filters.postedDate=ONE&language=en`, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);
    const extracted = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-cy="card"], dhi-search-card, .card'));
      return cards.slice(0, 25).map(card => ({
        title: card.querySelector('[data-cy="card-title-link"], h5, [class*="title"]')?.textContent?.trim() || 'N/A',
        company: card.querySelector('[data-cy="search-result-company-name"], [class*="company"]')?.textContent?.trim() || 'N/A',
        location: card.querySelector('[data-cy="search-result-location"], [class*="location"]')?.textContent?.trim() || '',
        url: (card.querySelector('a[data-cy="card-title-link"], a') as HTMLAnchorElement)?.href || '',
      }));
    });
    for (const item of extracted) {
      if (item.title !== 'N/A' && isValidJobUrl(item.url, 'https://www.dice.com')) {
        jobs.push({ id: `dice-${b64id(item.title, item.company)}`, title: item.title, company: item.company, location: item.location || undefined, remote: item.location?.toLowerCase().includes('remote') ? 'remote' : undefined, url: item.url, apply_url: item.url, source: 'dice' as any, fetched_at: new Date().toISOString(), tags: ['tech'] });
      }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Dice: ${err.message}`); }
  return { jobs, errors, source: 'dice', duration_ms: Date.now() - start };
}

// ── Built In ──────────────────────────────────────────────────────────────────
export async function scrapeBuiltIn(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const q = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://builtin.com/jobs?search=${q}&remote=true`, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);
    const extracted = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[class*="job-card"], [data-id], article'));
      return cards.slice(0, 25).map(card => ({
        title: card.querySelector('h2, h3, [class*="title"]')?.textContent?.trim() || 'N/A',
        company: card.querySelector('[class*="company"]')?.textContent?.trim() || 'N/A',
        location: card.querySelector('[class*="location"]')?.textContent?.trim() || '',
        url: (card.querySelector('a') as HTMLAnchorElement)?.href || '',
      }));
    });
    for (const item of extracted) {
      if (item.title !== 'N/A' && isValidJobUrl(item.url, 'https://builtin.com')) {
        jobs.push({ id: `builtin-${b64id(item.title, item.company)}`, title: item.title, company: item.company, location: item.location || undefined, url: item.url, apply_url: item.url, source: 'builtin' as any, fetched_at: new Date().toISOString(), tags: ['tech'] });
      }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Built In: ${err.message}`); }
  return { jobs, errors, source: 'builtin', duration_ms: Date.now() - start };
}

// ── ZipRecruiter ──────────────────────────────────────────────────────────────
export async function scrapeZipRecruiter(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const q = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://www.ziprecruiter.com/jobs-search?search=${q}&location=Remote`, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);
    const extracted = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[class*="job_result"], article[class*="job"], [data-job-id]'));
      return cards.slice(0, 25).map(card => ({
        title: card.querySelector('h2, h3, [class*="title"]')?.textContent?.trim() || 'N/A',
        company: card.querySelector('[class*="company"]')?.textContent?.trim() || 'N/A',
        location: card.querySelector('[class*="location"]')?.textContent?.trim() || '',
        salary: card.querySelector('[class*="salary"]')?.textContent?.trim() || '',
        url: (card.querySelector('a') as HTMLAnchorElement)?.href || '',
      }));
    });
    for (const item of extracted) {
      if (item.title !== 'N/A' && isValidJobUrl(item.url, 'https://www.ziprecruiter.com')) {
        jobs.push({ id: `zip-${b64id(item.title, item.company)}`, title: item.title, company: item.company, location: item.location || undefined, salary: item.salary || undefined, url: item.url, apply_url: item.url, source: 'ziprecruiter' as any, fetched_at: new Date().toISOString(), tags: [] });
      }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`ZipRecruiter: ${err.message}`); }
  return { jobs, errors, source: 'ziprecruiter', duration_ms: Date.now() - start };
}

// ── Monster ───────────────────────────────────────────────────────────────────
export async function scrapeMonster(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const q = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://www.monster.com/jobs/search?q=${q}&where=Remote`, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);
    const extracted = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="jobCard"], [class*="job-card"], article'));
      return cards.slice(0, 25).map(card => ({
        title: card.querySelector('h2, h3, [data-testid="job-title"]')?.textContent?.trim() || 'N/A',
        company: card.querySelector('[data-testid="company"], [class*="company"]')?.textContent?.trim() || 'N/A',
        location: card.querySelector('[data-testid="location"], [class*="location"]')?.textContent?.trim() || '',
        url: (card.querySelector('a') as HTMLAnchorElement)?.href || '',
      }));
    });
    for (const item of extracted) {
      if (item.title !== 'N/A' && isValidJobUrl(item.url, 'https://www.monster.com')) {
        jobs.push({ id: `monster-${b64id(item.title, item.company)}`, title: item.title, company: item.company, location: item.location || undefined, url: item.url, apply_url: item.url, source: 'monster' as any, fetched_at: new Date().toISOString(), tags: [] });
      }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Monster: ${err.message}`); }
  return { jobs, errors, source: 'monster', duration_ms: Date.now() - start };
}

// ── Revelo ────────────────────────────────────────────────────────────────────
export async function scrapeRevelo(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const keyword = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://www.revelo.com.br/vagas?q=${keyword}`, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);
    const extracted = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[class*="job"], [class*="vaga"], article'));
      return cards.slice(0, 30).map(card => ({
        title: card.querySelector('h2, h3, [class*="title"]')?.textContent?.trim() || 'N/A',
        company: card.querySelector('[class*="company"]')?.textContent?.trim() || 'N/A',
        location: card.querySelector('[class*="location"]')?.textContent?.trim() || '',
        salary: card.querySelector('[class*="salary"], [class*="salario"]')?.textContent?.trim() || '',
        url: (card.querySelector('a') as HTMLAnchorElement)?.href || '',
      }));
    });
    for (const item of extracted) {
      if (item.title !== 'N/A' && isValidJobUrl(item.url, 'https://www.revelo.com.br')) {
        jobs.push({ id: `revelo-${b64id(item.title, item.company)}`, title: item.title, company: item.company, location: item.location || undefined, salary: item.salary || undefined, url: item.url, apply_url: item.url, source: 'revelo' as any, fetched_at: new Date().toISOString(), tags: [] });
      }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Revelo: ${err.message}`); }
  return { jobs, errors, source: 'revelo', duration_ms: Date.now() - start };
}

// ── Sólides Vagas ─────────────────────────────────────────────────────────────
export async function scrapeSolides(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const q = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://vagas.solides.com.br/?q=${q}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.waitForSelector('[class*="job"], [class*="vaga"], article', { timeout: 8000 }).catch(() => {});
    const cards = await page.$$('[class*="JobCard"], [class*="job-card"], article[class*="job"], [data-testid*="job"]');
    for (const card of cards.slice(0, 30)) {
      try {
        const title = await txt(card, 'h2, h3, [class*="title"]') ?? 'N/A';
        const company = await txt(card, '[class*="company"], [class*="empresa"]') ?? 'N/A';
        const location = await txt(card, '[class*="location"], [class*="cidade"]');
        const link = await href(card, 'a');
        if (title !== 'N/A' && isValidJobUrl(link || '', 'https://vagas.solides.com.br')) jobs.push({ id: `solides-${b64id(title,company)}`, title, company, location, url: link!, apply_url: link, source: 'solides' as any, fetched_at: new Date().toISOString(), tags: [] });
      } catch { /* skip */ }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Sólides: ${err.message}`); }
  return { jobs, errors, source: 'solides', duration_ms: Date.now() - start };
}

// ── BNE ───────────────────────────────────────────────────────────────────────
export async function scrapeBne(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const q = encodeURIComponent(config.keywords.join(' '));
    const l = encodeURIComponent(config.location || '');
    await page.goto(`https://www.bne.com.br/vagas-de-emprego?q=${q}&l=${l}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const cards = await page.$$('[class*="vacancy"], [class*="job-item"], .vaga, article');
    for (const card of cards.slice(0, 30)) {
      try {
        const title = await txt(card, 'h2, h3, [class*="title"], .title') ?? 'N/A';
        const company = await txt(card, '[class*="company"], .company') ?? 'N/A';
        const location = await txt(card, '[class*="location"], .location');
        const link = await href(card, 'a');
        if (title !== 'N/A' && isValidJobUrl(link || '', 'https://www.bne.com.br')) jobs.push({ id: `bne-${b64id(title,company)}`, title, company, location, url: link!, apply_url: link, source: 'bne' as any, fetched_at: new Date().toISOString(), tags: [] });
      } catch { /* skip */ }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`BNE: ${err.message}`); }
  return { jobs, errors, source: 'bne', duration_ms: Date.now() - start };
}

// ── Empregos.com.br ───────────────────────────────────────────────────────────
export async function scrapeEmpregos(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const q = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://www.empregos.com.br/vagas/${q}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const cards = await page.$$('[class*="job"], [class*="vaga"], .listing-item, article');
    for (const card of cards.slice(0, 30)) {
      try {
        const title = await txt(card, 'h2, h3, [class*="title"]') ?? 'N/A';
        const company = await txt(card, '[class*="company"], [class*="empresa"]') ?? 'N/A';
        const location = await txt(card, '[class*="location"], [class*="cidade"]');
        const link = await href(card, 'a');
        if (title !== 'N/A' && isValidJobUrl(link || '', 'https://www.empregos.com.br')) jobs.push({ id: `empregos-${b64id(title,company)}`, title, company, location, url: link!, apply_url: link, source: 'empregos_br' as any, fetched_at: new Date().toISOString(), tags: [] });
      } catch { /* skip */ }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Empregos.com.br: ${err.message}`); }
  return { jobs, errors, source: 'empregos_br', duration_ms: Date.now() - start };
}

// ── CIEE (Estágio) ────────────────────────────────────────────────────────────
export async function scrapeCiee(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const q = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://portal.ciee.org.br/vagas/busca?q=${q}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const cards = await page.$$('[class*="vaga"], [class*="job"], [class*="opportunity"], article');
    for (const card of cards.slice(0, 30)) {
      try {
        const title = await txt(card, 'h2, h3, [class*="title"]') ?? 'N/A';
        const company = await txt(card, '[class*="company"], [class*="empresa"]') ?? 'N/A';
        const location = await txt(card, '[class*="location"], [class*="cidade"]');
        const link = await href(card, 'a');
        if (title !== 'N/A' && isValidJobUrl(link || '', 'https://portal.ciee.org.br')) jobs.push({ id: `ciee-${b64id(title,company)}`, title, company, location, url: link!, apply_url: link, source: 'ciee' as any, fetched_at: new Date().toISOString(), tags: ['estágio'] });
      } catch { /* skip */ }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`CIEE: ${err.message}`); }
  return { jobs, errors, source: 'ciee', duration_ms: Date.now() - start };
}

// ── Jooble (Agregador global) ─────────────────────────────────────────────────
export async function scrapeJooble(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const q = encodeURIComponent(config.keywords.join(' '));
    const l = encodeURIComponent(config.location || 'Brasil');
    await page.goto(`https://br.jooble.org/vagas-de-emprego/${encodeURIComponent(config.keywords.join('-'))}/${l}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const extracted = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('article, [class*="jobCard"], [data-id]'));
      return cards.slice(0, 30).map(card => ({
        title: card.querySelector('h2, h3, [class*="title"]')?.textContent?.trim() || 'N/A',
        company: card.querySelector('[class*="company"], [class*="employer"]')?.textContent?.trim() || 'N/A',
        location: card.querySelector('[class*="location"]')?.textContent?.trim() || '',
        salary: card.querySelector('[class*="salary"]')?.textContent?.trim() || '',
        url: (card.querySelector('a') as HTMLAnchorElement)?.href || '',
      }));
    });
    for (const item of extracted) {
      if (item.title !== 'N/A' && item.url) {
        jobs.push({ id: `jooble-${b64id(item.title, item.company)}`, title: item.title, company: item.company, location: item.location || undefined, salary: item.salary || undefined, url: item.url, apply_url: item.url, source: 'jooble' as any, fetched_at: new Date().toISOString(), tags: [] });
      }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Jooble: ${err.message}`); }
  return { jobs, errors, source: 'jooble', duration_ms: Date.now() - start };
}

// ── Otta (Tech/Startups global) ───────────────────────────────────────────────
export async function scrapeOtta(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const q = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://app.otta.com/jobs/search?query=${q}`, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);
    await page.waitForSelector('[class*="JobCard"], [class*="job-card"], article', { timeout: 10000 }).catch(() => {});
    const cards = await page.$$('[class*="JobCard"], [class*="job-item"], article[class*="job"]');
    for (const card of cards.slice(0, 25)) {
      try {
        const title = await txt(card, 'h2, h3, [class*="title"]') ?? 'N/A';
        const company = await txt(card, '[class*="company"]') ?? 'N/A';
        const location = await txt(card, '[class*="location"]');
        const salary = await txt(card, '[class*="salary"]');
        const link = await href(card, 'a');
        if (title !== 'N/A' && isValidJobUrl(link || '', 'https://app.otta.com')) jobs.push({ id: `otta-${b64id(title,company)}`, title, company, location, salary, remote: location?.toLowerCase().includes('remote') ? 'remote' : undefined, url: link || 'https://app.otta.com/jobs', apply_url: link, source: 'otta' as any, fetched_at: new Date().toISOString(), tags: ['startup','tech'] });
      } catch { /* skip */ }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Otta: ${err.message}`); }
  return { jobs, errors, source: 'otta', duration_ms: Date.now() - start };
}

// ── Workana (Freelance) ───────────────────────────────────────────────────────
export async function scrapeWorkana(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const q = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://www.workana.com/jobs?language=pt&search=${q}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const cards = await page.$$('[class*="project-item"], .project, [class*="job-item"]');
    for (const card of cards.slice(0, 30)) {
      try {
        const title = await txt(card, 'h2, h3, .title, [class*="title"]') ?? 'N/A';
        const budget = await txt(card, '[class*="budget"], [class*="price"], [class*="valor"]');
        const link = await href(card, 'a');
        if (title !== 'N/A' && isValidJobUrl(link || '', 'https://www.workana.com')) jobs.push({ id: `workana-${b64id(title, 'workana')}`, title, company: 'Workana (Freelance)', salary: budget, remote: 'remote', url: link!, apply_url: link, source: 'workana' as any, fetched_at: new Date().toISOString(), tags: ['freelance', 'remote'] });
      } catch { /* skip */ }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Workana: ${err.message}`); }
  return { jobs, errors, source: 'workana', duration_ms: Date.now() - start };
}

// ── Emprega Brasil / SINE ─────────────────────────────────────────────────────
export async function scrapeEmpregaBrasil(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const q = encodeURIComponent(config.keywords.join(' '));
    await page.goto(`https://empregabrasil.mte.gov.br/vagas?q=${q}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const cards = await page.$$('[class*="vaga"], [class*="job"], article, .card');
    for (const card of cards.slice(0, 30)) {
      try {
        const title = await txt(card, 'h2, h3, [class*="title"], [class*="cargo"]') ?? 'N/A';
        const company = await txt(card, '[class*="empresa"], [class*="company"]') ?? 'N/A';
        const location = await txt(card, '[class*="local"], [class*="cidade"], [class*="location"]');
        const salary = await txt(card, '[class*="salario"], [class*="salary"]');
        const link = await href(card, 'a');
        if (title !== 'N/A' && isValidJobUrl(link || '', 'https://empregabrasil.mte.gov.br')) jobs.push({ id: `sine-${b64id(title,company)}`, title, company, location, salary, url: link!, apply_url: link, source: 'sine' as any, fetched_at: new Date().toISOString(), tags: ['CLT', 'governo'] });
      } catch { /* skip */ }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Emprega Brasil: ${err.message}`); }
  return { jobs, errors, source: 'sine', duration_ms: Date.now() - start };
}

// ── Trovit (Agregador) ────────────────────────────────────────────────────────
export async function scrapeTrovit(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now(); const jobs: Job[] = []; const errors: string[] = [];
  try {
    const ctx = await newCtx(); const page = await ctx.newPage(); await stealth(page);
    const q = encodeURIComponent(config.keywords.join(' '));
    const l = encodeURIComponent(config.location || '');
    await page.goto(`https://empregos.trovit.com.br/index.php/cod.search_jobs/what_is.${q}/where_is.${l}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const extracted = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('article, [class*="item"], [class*="job"]'));
      return cards.slice(0, 30).map(card => ({
        title: card.querySelector('h2 a, h3 a, [class*="title"] a')?.textContent?.trim() || 'N/A',
        company: card.querySelector('[class*="source"], [class*="company"]')?.textContent?.trim() || 'N/A',
        location: card.querySelector('[class*="location"], [class*="city"]')?.textContent?.trim() || '',
        url: (card.querySelector('h2 a, h3 a, a[class*="title"]') as HTMLAnchorElement)?.href || '',
      }));
    });
    for (const item of extracted) {
      if (item.title !== 'N/A' && item.url) {
        jobs.push({ id: `trovit-${b64id(item.title, item.company)}`, title: item.title, company: item.company, location: item.location || undefined, url: item.url, apply_url: item.url, source: 'trovit' as any, fetched_at: new Date().toISOString(), tags: [] });
      }
    }
    await ctx.close();
  } catch (err: any) { errors.push(`Trovit: ${err.message}`); }
  return { jobs, errors, source: 'trovit', duration_ms: Date.now() - start };
}
