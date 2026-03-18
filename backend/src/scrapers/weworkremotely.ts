import axios from 'axios';
import { Job, ScraperResult, SearchConfig } from '../types';

// We Work Remotely exposes public RSS feeds per category
// https://weworkremotely.com/remote-job-rss-feed
const WWR_FEEDS: Record<string, string> = {
  all:        'https://weworkremotely.com/remote-jobs.rss',
  programming:'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  design:     'https://weworkremotely.com/categories/remote-design-jobs.rss',
  devops:     'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
  sales:      'https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss',
  management: 'https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss',
  support:    'https://weworkremotely.com/categories/remote-customer-support-jobs.rss',
  other:      'https://weworkremotely.com/categories/all-other-remote-jobs.rss',
};

function parseRss(xml: string): any[] {
  const items: any[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag: string) => {
      const m = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`).exec(block);
      return m ? (m[1] || m[2] || '').trim() : '';
    };
    items.push({
      title:   get('title'),
      link:    get('link'),
      pubDate: get('pubDate'),
      company: get('company_name'),
      region:  get('region'),
      desc:    get('description'),
    });
  }
  return items;
}

export async function scrapeWeWorkRemotely(config: SearchConfig): Promise<ScraperResult> {
  const start = Date.now();
  const jobs: Job[] = [];
  const errors: string[] = [];
  const keywords = config.keywords.map(k => k.toLowerCase());

  // Pick relevant feed — use 'all' for broad search, 'programming' for tech
  const feedUrl = WWR_FEEDS['all'];

  try {
    const resp = await axios.get(feedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)', 'Accept': 'application/rss+xml, text/xml' },
      timeout: 15000,
      responseType: 'text',
    });

    const items = parseRss(resp.data as string);

    for (const item of items) {
      const text = `${item.title} ${item.desc}`.toLowerCase();
      if (keywords.length > 0 && !keywords.some(k => text.includes(k))) continue;

      // Title format: "Company: Job Title"
      const colonIdx = item.title.indexOf(':');
      const company = colonIdx > -1 ? item.title.slice(0, colonIdx).trim() : (item.company || 'N/A');
      const title = colonIdx > -1 ? item.title.slice(colonIdx + 1).trim() : item.title;

      jobs.push({
        id: `wwr-${Buffer.from(item.link || title).toString('base64').slice(0, 16)}`,
        title,
        company,
        location: item.region || 'Remoto',
        remote: 'remote',
        url: item.link,
        apply_url: item.link,
        source: 'weworkremotely' as any,
        posted_at: item.pubDate,
        fetched_at: new Date().toISOString(),
        tags: ['remote'],
      });
    }
  } catch (err: any) {
    errors.push(`WeWorkRemotely: ${err.message}`);
  }

  return { jobs, errors, source: 'weworkremotely', duration_ms: Date.now() - start };
}
