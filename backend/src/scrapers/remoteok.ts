import axios from 'axios';
import { Job, ScraperResult, SearchConfig } from '../types';

// RemoteOK has a fully public JSON API — no auth needed
// https://remoteok.com/api — returns array, first element is metadata
export async function scrapeRemoteOK(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now();
  const jobs: Job[] = [];
  const errors: string[] = [];
  const keywords = config.keywords.map(k => k.toLowerCase());

  try {
    const resp = await axios.get('https://remoteok.com/api', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)',
        'Accept': 'application/json',
        'Referer': 'https://remoteok.com/',
      },
      timeout: 20000,
    });

    // First element is a metadata/legal notice object — skip it
    const raw: any[] = Array.isArray(resp.data) ? resp.data.slice(1) : [];

    for (const item of raw) {
      if (!item?.position) continue;
      const text = `${item.position} ${item.description || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
      if (keywords.length > 0 && !keywords.some(k => text.includes(k))) continue;

      jobs.push({
        id: `remoteok-${item.id || item.slug}`,
        title: item.position,
        company: item.company || 'N/A',
        location: 'Remoto',
        remote: 'remote',
        salary: item.salary_min
          ? `$${item.salary_min}–$${item.salary_max}`
          : undefined,
        description: item.description || undefined,
        requirements: item.tags || [],
        url: item.url || `https://remoteok.com/remote-jobs/${item.slug}`,
        apply_url: item.apply_url || item.url,
        source: 'remoteok' as any,
        posted_at: item.date,
        fetched_at: new Date().toISOString(),
        tags: item.tags || [],
      });
    }
  } catch (err: any) {
    errors.push(`RemoteOK: ${err.message}`);
  }

  return { jobs, errors, source: 'remoteok', duration_ms: Date.now() - start };
}
