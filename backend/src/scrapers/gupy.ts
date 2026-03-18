import axios from 'axios';
import { v4 as uuid } from 'uuid';
import { Job, ScraperResult, SearchConfig } from '../types';

void uuid; // imported for potential future use

const GUPY_API = 'https://portal.gupy.io/api/search/v1';

export async function scrapeGupy(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now();
  const jobs: Job[] = [];
  const errors: string[] = [];

  try {
    const keywords = config.keywords.join(' ');
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 10) {
      const params: Record<string, string | number | boolean> = {
        jobName: keywords,
        limit: 20,
        offset: (page - 1) * 20,
      };
      if (config.location) params['cityName'] = config.location;
      if (config.remote_only) params['workplaceType'] = 'remote';

      const response = await axios.get(GUPY_API, {
        params,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://portal.gupy.io/',
        },
        timeout: 15000,
      });

      const results: any[] = response.data?.data || [];
      if (results.length === 0) { hasMore = false; break; }
      for (const item of results) jobs.push(mapGupyJob(item));
      hasMore = results.length === 20;
      page++;
      await sleep(800);
    }
  } catch (err: any) {
    errors.push(`Gupy error: ${err.message}`);
  }

  return { jobs, errors, source: 'gupy', duration_ms: Date.now() - start };
}

function mapGupyJob(item: any): Job {
  const companySlug: string = item.careerPageSlug || item.companySlug || '';
  const jobId: string | number = item.id || item.jobId;
  return {
    id: `gupy-${jobId}`,
    title: item.name || item.title || 'N/A',
    company: item.careerPageName || item.companyName || 'N/A',
    location: [item.city, item.state, item.country].filter(Boolean).join(', ') || undefined,
    remote: mapRemote(item.workplaceType),
    salary: item.salary || undefined,
    description: item.description || undefined,
    requirements: [],
    url: `https://portal.gupy.io/job-opportunities/${jobId}`,
    apply_url: companySlug
      ? `https://${companySlug}.gupy.io/jobs/${jobId}`
      : `https://portal.gupy.io/job-opportunities/${jobId}`,
    source: 'gupy',
    posted_at: item.publishedDate || item.createdAt,
    fetched_at: new Date().toISOString(),
    tags: [item.type, item.workplaceType].filter(Boolean),
  };
}

function mapRemote(type?: string): Job['remote'] {
  if (!type) return undefined;
  if (type === 'remote') return 'remote';
  if (type === 'hybrid') return 'hybrid';
  return 'onsite';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Gupy white-label company portals ──────────────────────────────────────────
// Companies like DBC host their own Gupy portal at {slug}.gupy.io
// The API is the same, just scoped to that company's slug.

export async function scrapeGupyCompany(
  companySlug: string,
  config: SearchConfig
): Promise<ScraperResult> {
  const start = Date.now();
  const jobs: Job[] = [];
  const errors: string[] = [];

  try {
    const keyword = config.keywords.join(' ');
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 5) {
      const resp = await axios.get(`https://portal.gupy.io/api/search/v1`, {
        params: {
          jobName: keyword,
          careerPageSlug: companySlug, // scope to company
          limit: 20,
          offset: (page - 1) * 20,
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': `https://${companySlug}.gupy.io/`,
        },
        timeout: 15000,
      });

      const results: any[] = resp.data?.data || [];
      if (!results.length) { hasMore = false; break; }
      for (const item of results) jobs.push(mapGupyJob(item));
      hasMore = results.length === 20;
      page++;
      await sleep(600);
    }
  } catch (err: any) {
    errors.push(`Gupy [${companySlug}]: ${err.message}`);
  }

  return { jobs, errors, source: 'gupy', duration_ms: Date.now() - start };
}

// Known company slugs that use Gupy white-label
export const KNOWN_GUPY_COMPANIES: Record<string, string> = {
  'dbc':          'dbccompany',
  'totvs':        'totvs',
  'nava':         'nava-technology-for-business-1',
  'senior':       'senior-sistemas',
  'stefanini':    'stefanini',
  'atos':         'atos',
  'ci&t':         'ciandt',
  'accenture':    'accenture-brasil',
  'capgemini':    'capgemini',
  'wipro':        'wipro-brasil',
};
