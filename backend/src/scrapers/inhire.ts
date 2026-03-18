import axios from 'axios';
import { Job, ScraperResult, SearchConfig } from '../types';

const INHIRE_API = 'https://api.inhire.com.br/public';

export async function scrapeInhire(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now();
  const jobs: Job[] = [];
  const errors: string[] = [];

  try {
    let exclusiveStartKey: string | undefined;
    let hasMore = true;
    let pages = 0;

    while (hasMore && pages < 10) {
      const params: Record<string, string | number> = {
        limit: 20,
        keywords: config.keywords.join(','),
      };
      if (config.location) params['location'] = config.location;
      if (config.remote_only) params['remote'] = 'true';
      if (exclusiveStartKey) params['exclusiveStartKey'] = exclusiveStartKey;

      const response = await axios.get(`${INHIRE_API}/jobs`, {
        params,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)', 'Accept': 'application/json' },
        timeout: 15000,
      });

      const data = response.data;
      const results: any[] = data?.jobs || data?.data || data?.items || [];
      if (results.length === 0) break;
      for (const item of results) jobs.push(mapInhireJob(item));
      exclusiveStartKey = data?.startKey || data?.nextKey || data?.pagination?.next;
      hasMore = !!exclusiveStartKey && results.length === 20;
      pages++;
      await sleep(600);
    }
  } catch (err: any) {
    errors.push(`Inhire error: ${err.message}`);
  }

  return { jobs, errors, source: 'inhire', duration_ms: Date.now() - start };
}

function mapInhireJob(item: any): Job {
  return {
    id: `inhire-${item.id || item.jobId || item.slug}`,
    title: item.title || item.name || 'N/A',
    company: item.company?.name || item.companyName || 'N/A',
    location: item.location || item.city || undefined,
    remote: mapRemote(item.workModel || item.remote),
    salary: item.salary || item.salaryRange || undefined,
    description: item.description || undefined,
    requirements: item.requirements || [],
    url: item.url || `https://app.inhire.com.br/vagas/${item.id}`,
    apply_url: item.applyUrl || item.url,
    source: 'inhire',
    posted_at: item.publishedAt || item.createdAt,
    fetched_at: new Date().toISOString(),
    tags: item.tags || [],
  };
}

function mapRemote(value?: string | boolean): Job['remote'] {
  if (value === true || value === 'remote') return 'remote';
  if (value === 'hybrid') return 'hybrid';
  if (value === false || value === 'onsite' || value === 'presencial') return 'onsite';
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Inhire white-label subdomains ─────────────────────────────────────────────
// Companies like Contabilizei use {company}.inhire.app
// The API is the same as inhire.com.br/public, scoped to that company.

export async function scrapeInhireCompany(
  companySlug: string,
  config: SearchConfig
): Promise<ScraperResult> {
  const start = Date.now();
  const jobs: Job[] = [];
  const errors: string[] = [];

  try {
    let exclusiveStartKey: string | undefined;
    let hasMore = true;
    let pages = 0;

    while (hasMore && pages < 5) {
      const params: Record<string, string | number> = {
        limit: 20,
        keywords: config.keywords.join(','),
      };
      if (exclusiveStartKey) params['exclusiveStartKey'] = exclusiveStartKey;

      // White-label Inhire uses the company subdomain
      const resp = await axios.get(`https://${companySlug}.inhire.app/api/v1/jobs`, {
        params,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)',
          'Accept': 'application/json',
          'Origin': `https://${companySlug}.inhire.app`,
        },
        timeout: 15000,
      });

      const data = resp.data;
      const results: any[] = data?.jobs || data?.data || data?.items || [];
      if (!results.length) break;

      for (const item of results) {
        const mapped = mapInhireJob(item);
        // Override URL to point to company portal
        mapped.url = `https://${companySlug}.inhire.app/vagas/${item.id || item.slug}`;
        mapped.apply_url = mapped.url;
        jobs.push(mapped);
      }

      exclusiveStartKey = data?.startKey || data?.nextKey;
      hasMore = !!exclusiveStartKey && results.length === 20;
      pages++;
      await sleep(500);
    }
  } catch (err: any) {
    errors.push(`Inhire [${companySlug}]: ${err.message}`);
  }

  return { jobs, errors, source: 'inhire', duration_ms: Date.now() - start };
}

// Known companies that use Inhire white-label
export const KNOWN_INHIRE_COMPANIES: Record<string, string> = {
  'contabilizei': 'contabilizei',
  'loft':         'loft',
  'creditas':     'creditas',
  'dock':         'dock',
  'zup':          'zup',
  'madeiramadeira': 'madeiramadeira',
  'getnet':       'getnet',
};
