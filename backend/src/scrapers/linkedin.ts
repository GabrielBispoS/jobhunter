import { chromium } from 'playwright';
import { Job, ScraperResult, SearchConfig } from '../types';

function toId(title: string, company: string): string {
  return Buffer.from(`${title}-${company}`).toString('base64url').slice(0, 20);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Scraper público do LinkedIn Jobs (sem login).
 *
 * LinkedIn permite busca pública limitada — sem autenticação conseguimos
 * título, empresa, localização e URL da vaga. Easy Apply requer login,
 * então o apply_url aponta para a página da vaga para candidatura manual.
 *
 * Anti-bot: stealth básico + delay humano + user-agent realista.
 */
export async function scrapeLinkedIn(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now();
  const jobs: Job[] = [];
  const errors: string[] = [];

  const browser = await chromium.launch({
    headless: process.env['HEADLESS'] !== 'false',
    executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  });

  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'pt-BR',
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: { 'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7' },
  });

  const page = await ctx.newPage();

  // Stealth — ocultar webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    (window as any).chrome = { runtime: {} };
  });

  try {
    const keyword = config.keywords.join(' ');
    const location = config.location || 'Brazil';
    const remoteFilter = config.remote_only ? '&f_WT=2' : '';

    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}${remoteFilter}&sortBy=DD`;

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await sleep(2000);

    // Fecha modal de login se aparecer
    const closeBtn = await page.$('button[aria-label="Fechar"], button[aria-label="Dismiss"], .modal__dismiss').catch(() => null);
    if (closeBtn) { await closeBtn.click().catch(() => {}); await sleep(500); }

    // Aguarda os cards de vaga carregarem
    await page.waitForSelector('.base-card, .job-search-card, [data-entity-urn]', { timeout: 15000 }).catch(() => {});

    const extracted = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(
        '.base-card.relative, .base-search-card, li.jobs-search-results__list-item, .job-search-card'
      ));
      return cards.slice(0, 30).map(card => {
        const titleEl = card.querySelector('h3.base-search-card__title, h3.job-result-card__title, .base-card__full-link') as HTMLElement | null;
        const companyEl = card.querySelector('h4.base-search-card__subtitle, .job-result-card__subtitle-link, a[data-tracking-control-name="public_jobs_jserp-result_job-search-card-subtitle"]') as HTMLElement | null;
        const locationEl = card.querySelector('.job-search-card__location, .base-search-card__metadata > span:first-child') as HTMLElement | null;
        const linkEl = card.querySelector('a.base-card__full-link, a[href*="/jobs/view/"]') as HTMLAnchorElement | null;
        const metaEl = card.querySelector('.job-search-card__benefits, .job-result-card__listdate') as HTMLElement | null;

        const title = titleEl?.textContent?.trim() || '';
        const company = companyEl?.textContent?.trim() || '';
        const location = locationEl?.textContent?.trim() || '';
        const url = linkEl?.href || '';
        const meta = metaEl?.textContent?.trim() || '';

        return { title, company, location, url, meta };
      });
    });

    for (const item of extracted) {
      if (!item.title || !item.url || !item.url.includes('linkedin.com')) continue;

      const remoteKeywords = ['remote', 'remoto', 'home office'];
      const isRemote = remoteKeywords.some(k => item.location.toLowerCase().includes(k) || item.meta.toLowerCase().includes(k));

      // Normaliza URL para remover tracking params
      let cleanUrl = item.url;
      try {
        const u = new URL(item.url);
        cleanUrl = `${u.origin}${u.pathname}`;
      } catch { /* keep original */ }

      jobs.push({
        id: `linkedin-${toId(item.title, item.company || 'unknown')}`,
        title: item.title,
        company: item.company || 'N/A',
        location: item.location || undefined,
        remote: isRemote ? 'remote' : undefined,
        url: cleanUrl,
        apply_url: cleanUrl,
        source: 'linkedin',
        fetched_at: new Date().toISOString(),
        tags: ['linkedin'],
      });
    }
  } catch (err: any) {
    errors.push(`LinkedIn: ${err.message}`);
  } finally {
    await ctx.close();
    await browser.close();
  }

  return { jobs, errors, source: 'linkedin', duration_ms: Date.now() - start };
}
