import axios from 'axios';
import { Job, ScraperResult, SearchConfig } from '../types';

// Vagas.com.br exposes a semi-public XML/JSON search used by their frontend
// Pattern: https://www.vagas.com.br/vagas-de-{keyword}?p={page}
// They also have a search endpoint: /api/v1/opportunities?q=&page=
// 99jobs uses a simple paginated API: https://99jobs.com/api/v1/jobs?q=

export async function scrapeVagasBr(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now();
  const jobs: Job[] = [];
  const errors: string[] = [];

  try {
    const keyword = config.keywords.join(' ');

    // Vagas.com.br has an internal API used by their search page
    const resp = await axios.get('https://www.vagas.com.br/api/v1/vacancies', {
      params: {
        q: keyword,
        location: config.location || '',
        page: 1,
        per_page: 40,
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.vagas.com.br/',
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 15000,
    });

    const items: any[] = resp.data?.vacancies || resp.data?.data || resp.data?.results || [];
    for (const item of items) {
      jobs.push(mapVagasBr(item));
    }
  } catch (err: any) {
    errors.push(`Vagas.com.br: ${err.message}`);
  }

  return { jobs, errors, source: 'vagas_br' as any, duration_ms: Date.now() - start };
}

export async function scrape99Jobs(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now();
  const jobs: Job[] = [];
  const errors: string[] = [];

  try {
    const keyword = config.keywords.join(' ');
    for (let page = 1; page <= 3; page++) {
      const resp = await axios.get('https://99jobs.com/api/v1/jobs', {
        params: { q: keyword, page, per_page: 20 },
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)',
          'Accept': 'application/json',
        },
        timeout: 12000,
      });
      const items: any[] = resp.data?.jobs || resp.data?.data || [];
      if (!items.length) break;
      for (const item of items) {
        jobs.push({
          id: `99jobs-${item.id || item.slug}`,
          title: item.title || item.name || 'N/A',
          company: item.company?.name || item.company_name || 'N/A',
          location: item.city || item.location || undefined,
          remote: item.remote ? 'remote' : item.modality === 'hybrid' ? 'hybrid' : undefined,
          salary: item.salary_range || item.salary || undefined,
          description: item.description || undefined,
          url: `https://99jobs.com/vagas/${item.slug || item.id}`,
          apply_url: item.apply_url || `https://99jobs.com/vagas/${item.slug || item.id}`,
          source: '99jobs' as any,
          posted_at: item.published_at || item.created_at,
          fetched_at: new Date().toISOString(),
          tags: item.tags || [],
        });
      }
      await sleep(600);
    }
  } catch (err: any) {
    errors.push(`99Jobs: ${err.message}`);
  }

  return { jobs, errors, source: '99jobs' as any, duration_ms: Date.now() - start };
}

function mapVagasBr(item: any): Job {
  const id = item.id || item.code;
  return {
    id: `vagas-${id}`,
    title: item.title || item.role || 'N/A',
    company: item.company?.name || item.company_name || 'N/A',
    location: [item.city, item.state].filter(Boolean).join(', ') || undefined,
    remote: item.remote || item.modality === 'remote' ? 'remote'
          : item.modality === 'hybrid' ? 'hybrid' : undefined,
    salary: item.salary || undefined,
    description: item.description || item.summary || undefined,
    url: `https://www.vagas.com.br/vagas/${item.slug || id}`,
    apply_url: item.apply_url || `https://www.vagas.com.br/vagas/${item.slug || id}`,
    source: 'vagas_br' as any,
    posted_at: item.published_at || item.created_at,
    fetched_at: new Date().toISOString(),
    tags: item.benefits ? ['CLT'] : [],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
