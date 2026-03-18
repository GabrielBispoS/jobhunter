import axios from 'axios';
import { Job, ScraperResult, SearchConfig } from '../types';

// Cornerstone OnDemand (CSOD) career sites expose a public REST API.
// Pattern: https://{client}.csod.com/services/api/ats/v1/requisitions?culture=pt-BR&q={keyword}
// Used by Bradesco, Itaú, Ambev, and many large BR corporates.

export interface CsodConfig extends SearchConfig {
  csodClients?: string[]; // e.g. ['bradesco', 'itau', 'ambev']
}

const DEFAULT_CLIENTS = ['bradesco', 'itau', 'ambev', 'totvs', 'globo'];

export async function scrapeCsod(config: CsodConfig): Promise<ScraperResult> {
  const start = Date.now();
  const jobs: Job[] = [];
  const errors: string[] = [];

  const clients = config.csodClients || DEFAULT_CLIENTS;
  const keyword = config.keywords.join(' ');

  for (const client of clients) {
    try {
      // CSOD public career-site API — no auth required for published reqs
      const resp = await axios.get(
        `https://${client}.csod.com/services/api/ats/v1/requisitions`,
        {
          params: {
            culture: 'pt-BR',
            q: keyword,
            pageSize: 50,
            pageNumber: 0,
            careerSiteId: 1,
          },
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)',
            'Accept': 'application/json',
          },
          timeout: 12000,
        }
      );

      const items: any[] = resp.data?.requisitions || resp.data?.data || resp.data?.results || [];

      for (const item of items) {
        jobs.push(mapCsodJob(item, client));
      }
    } catch (err: any) {
      // Skip clients that don't have public CSOD portals — silent fail
      if (err.response?.status !== 404 && err.response?.status !== 403) {
        errors.push(`CSOD [${client}]: ${err.message}`);
      }
    }

    await sleep(500);
  }

  return { jobs, errors, source: 'csod', duration_ms: Date.now() - start };
}

// Scrape a specific CSOD client's career site (for known URLs like Bradesco)
export async function scrapeCsodClient(client: string, config: SearchConfig): Promise<ScraperResult> {
  return scrapeCsod({ ...config, csodClients: [client] });
}

function mapCsodJob(item: any, client: string): Job {
  const reqId = item.requisitionId || item.id || item.reqId;
  const url = `https://${client}.csod.com/ux/ats/careersite/1/home/requisition/${reqId}?c=${client}`;

  return {
    id: `csod-${client}-${reqId}`,
    title: item.title || item.jobTitle || item.displayTitle || 'N/A',
    company: item.companyName || client.charAt(0).toUpperCase() + client.slice(1),
    location: [item.city, item.state, item.country].filter(Boolean).join(', ') || undefined,
    remote: item.isRemote ? 'remote' : item.workType === 'hybrid' ? 'hybrid' : undefined,
    salary: undefined, // CSOD rarely exposes salary in API
    description: item.jobDescription || item.description || undefined,
    requirements: [],
    url,
    apply_url: url,
    source: 'csod' as any,
    posted_at: item.postingDate || item.datePosted || item.openDate,
    fetched_at: new Date().toISOString(),
    tags: [item.department, item.category].filter(Boolean),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
