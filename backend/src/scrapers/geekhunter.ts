import axios from 'axios';
import { Job, ScraperResult, SearchConfig } from '../types';

// GeekHunter exposes a public search endpoint used by its own frontend
// Pattern discovered via browser devtools: /vagas page fetches /api/v1/jobs
const GEEKHUNTER_API = 'https://www.geekhunter.com.br/api/v1/jobs';
const GEEKHUNTER_SEARCH = 'https://www.geekhunter.com.br/api/v1/job_opportunities/search';

export async function scrapeGeekHunter(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now();
  const jobs: Job[] = [];
  const errors: string[] = [];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.geekhunter.com.br/vagas',
    'Accept-Language': 'pt-BR,pt;q=0.9',
  };

  try {
    // Try JSON search endpoint first
    const keyword = config.keywords.join(' ');
    let fetched = false;

    // Attempt 1: search API
    try {
      const resp = await axios.get(GEEKHUNTER_SEARCH, {
        params: { q: keyword, per_page: 30, page: 1 },
        headers,
        timeout: 15000,
      });
      const items: any[] = resp.data?.jobs || resp.data?.data || resp.data?.job_opportunities || [];
      for (const item of items) jobs.push(mapGeekHunterJob(item));
      if (items.length > 0) fetched = true;
    } catch { /* fallback below */ }

    // Attempt 2: paginated listing API
    if (!fetched) {
      for (let page = 1; page <= 5; page++) {
        const resp = await axios.get(GEEKHUNTER_API, {
          params: { q: keyword, page, per_page: 20 },
          headers,
          timeout: 15000,
        });
        const items: any[] = resp.data?.jobs || resp.data?.data || [];
        if (!items.length) break;
        for (const item of items) jobs.push(mapGeekHunterJob(item));
        await sleep(700);
      }
    }
  } catch (err: any) {
    errors.push(`GeekHunter error: ${err.message}`);
  }

  return { jobs, errors, source: 'geekhunter', duration_ms: Date.now() - start };
}

function mapGeekHunterJob(item: any): Job {
  const slug = item.slug || item.id;
  const companySlug = item.company?.slug || item.company_slug || '';
  const jobUrl = companySlug
    ? `https://www.geekhunter.com.br/${companySlug}/jobs/${slug}`
    : `https://www.geekhunter.com.br/vagas/${slug}`;

  return {
    id: `geekhunter-${item.id || slug}`,
    title: item.title || item.name || 'N/A',
    company: item.company?.name || item.company_name || 'N/A',
    location: item.city || item.location || (item.remote ? 'Remoto' : undefined),
    remote: item.remote || item.work_model === 'remote' ? 'remote'
          : item.work_model === 'hybrid' ? 'hybrid'
          : item.work_model === 'on_site' ? 'onsite'
          : undefined,
    salary: item.salary_range || item.salary || undefined,
    description: item.description || item.summary || undefined,
    requirements: item.skills?.map((s: any) => s.name || s) || [],
    url: jobUrl,
    apply_url: jobUrl,
    source: 'geekhunter' as any,
    posted_at: item.created_at || item.published_at,
    fetched_at: new Date().toISOString(),
    tags: ['tech', item.seniority].filter(Boolean),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
