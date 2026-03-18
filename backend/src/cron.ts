/**
 * Scheduled job searches using node-cron.
 * Reads search configs from DB and runs them on schedule.
 * Sends email alerts when new jobs are found.
 */

import cron from 'node-cron';
import { getDb, all, get, run as dbRun } from './db';
import { sendJobAlert, isMailConfigured } from './mailer';
import { fingerprint, deduplicateJobs } from './dedup';
import { Job, SearchConfig } from './types';

interface ScheduleConfig {
  id: string;
  name: string;
  keywords: string;      // JSON array string
  location?: string;
  remote_only: number;   // 0|1
  sources: string;       // JSON array string
  schedule: string;      // cron expression
  active: number;        // 0|1
  notify_email: number;  // 0|1
}

// Lazy import scrapers to avoid circular deps
async function runScrape(config: SearchConfig, sources: string[]): Promise<Job[]> {
  const { scrapeGupy } = await import('./scrapers/gupy');
  const { scrapeInhire } = await import('./scrapers/inhire');
  const { scrapeGeekHunter } = await import('./scrapers/geekhunter');
  const { scrapeRemoteOK } = await import('./scrapers/remoteok');
  const { scrapeWeWorkRemotely } = await import('./scrapers/weworkremotely');
  const { scrapeVagasBr, scrape99Jobs } = await import('./scrapers/vagas_br');
  const { scrapeGlassdoor, scrapeCatho, scrapeInfoJobs } = await import('./scrapers/playwright');
  const {
    scrapeProgramathor, scrapeRevelo, scrapeRemotar,
    scrapeTrabalha, scrapeIndeed,
  } = await import('./scrapers/global_playwright');

  const API_MAP: Record<string, (c: SearchConfig) => Promise<any>> = {
    gupy:           scrapeGupy,
    inhire:         scrapeInhire,
    geekhunter:     scrapeGeekHunter,
    remoteok:       scrapeRemoteOK,
    weworkremotely: scrapeWeWorkRemotely,
    vagas_br:       scrapeVagasBr,
    '99jobs':       scrape99Jobs,
  };

  const BROWSER_MAP: Record<string, (c: SearchConfig) => Promise<any>> = {
    glassdoor:   scrapeGlassdoor,
    catho:       scrapeCatho,
    infojobs:    scrapeInfoJobs,
    programathor:scrapeProgramathor,
    revelo:      scrapeRevelo,
    remotar:     scrapeRemotar,
    trabalha_brasil: scrapeTrabalha,
    indeed:      scrapeIndeed,
  };

  const allJobs: Job[] = [];

  // API scrapers in parallel
  const apiResults = await Promise.allSettled(
    sources.filter(s => s in API_MAP).map(s => API_MAP[s]!(config))
  );
  for (const r of apiResults) {
    if (r.status === 'fulfilled') allJobs.push(...r.value.jobs);
  }

  // Browser scrapers sequentially
  for (const source of sources.filter(s => s in BROWSER_MAP)) {
    try {
      const r = await BROWSER_MAP[source]!(config);
      allJobs.push(...r.jobs);
    } catch { /* skip failed source */ }
  }

  return allJobs;
}

async function executeSchedule(cfg: ScheduleConfig): Promise<void> {
  const db = await getDb();
  const keywords: string[] = JSON.parse(cfg.keywords);
  const sources: string[] = JSON.parse(cfg.sources);

  console.log(`🕐 Cron [${cfg.name}] starting — keywords: ${keywords.join(', ')}`);

  const config: SearchConfig = {
    keywords,
    location: cfg.location,
    remote_only: cfg.remote_only === 1,
    sources,
  };

  try {
    // Get existing fingerprints to detect NEW jobs
    const existingRows = all(db, 'SELECT title, company FROM jobs');
    const existingFps = new Set(
      existingRows.map(r => fingerprint({ title: r['title'] as string, company: r['company'] as string } as Job))
    );

    const scrapedJobs = await runScrape(config, sources);
    const newJobs = deduplicateJobs(scrapedJobs, existingFps);

    if (newJobs.length > 0) {
      // Save to DB
      const { upsertJobs } = await import('./db');
      await upsertJobs(newJobs);

      console.log(`✅ Cron [${cfg.name}] — ${newJobs.length} new jobs saved`);

      // Send email if configured and enabled
      if (cfg.notify_email === 1 && isMailConfigured()) {
        await sendJobAlert(newJobs, keywords, scrapedJobs.length);
      }
    } else {
      console.log(`ℹ️ Cron [${cfg.name}] — no new jobs found`);
    }

    // Update last_run
    dbRun(db, 'UPDATE search_schedules SET last_run = $ts WHERE id = $id', {
      $ts: new Date().toISOString(), $id: cfg.id,
    });
  } catch (err: any) {
    console.error(`❌ Cron [${cfg.name}] error:`, err.message);
  }
}

const activeTasks = new Map<string, cron.ScheduledTask>();

export async function startCronJobs(): Promise<void> {
  const db = await getDb();
  ensureScheduleTable(db);

  const schedules = all(db, 'SELECT * FROM search_schedules WHERE active = 1') as ScheduleConfig[];

  for (const cfg of schedules) {
    if (!cron.validate(cfg.schedule)) {
      console.warn(`⚠️ Invalid cron expression for [${cfg.name}]: ${cfg.schedule}`);
      continue;
    }
    const task = cron.schedule(cfg.schedule, () => executeSchedule(cfg), { timezone: 'America/Sao_Paulo' });
    activeTasks.set(cfg.id, task);
    console.log(`⏰ Scheduled [${cfg.name}] — ${cfg.schedule}`);
  }

  // Default schedule: if no DB config, use env variable
  const defaultCron = process.env['DEFAULT_CRON'];
  const defaultKeywords = process.env['DEFAULT_KEYWORDS'];
  const defaultSources = process.env['DEFAULT_SOURCES'];

  if (defaultCron && defaultKeywords && cron.validate(defaultCron)) {
    const keywords = defaultKeywords.split(',').map(k => k.trim());
    const sources = defaultSources ? defaultSources.split(',') : ['gupy','inhire','remoteok'];
    const fakeCfg: ScheduleConfig = {
      id: 'env-default', name: 'Default (env)', active: 1,
      keywords: JSON.stringify(keywords), sources: JSON.stringify(sources),
      schedule: defaultCron, remote_only: 0, notify_email: 1,
    };
    const task = cron.schedule(defaultCron, () => executeSchedule(fakeCfg), { timezone: 'America/Sao_Paulo' });
    activeTasks.set('env-default', task);
    console.log(`⏰ Default cron scheduled — ${defaultCron} — keywords: ${keywords.join(', ')}`);
  }
}

export async function reloadCronJobs(): Promise<void> {
  for (const task of activeTasks.values()) task.stop();
  activeTasks.clear();
  await startCronJobs();
}

function ensureScheduleTable(db: any): void {
  dbRun(db, `
    CREATE TABLE IF NOT EXISTS search_schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      keywords TEXT NOT NULL,
      location TEXT,
      remote_only INTEGER DEFAULT 0,
      sources TEXT NOT NULL,
      schedule TEXT NOT NULL DEFAULT '0 8 * * *',
      active INTEGER DEFAULT 1,
      notify_email INTEGER DEFAULT 1,
      last_run TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

// Export for route use
export { ensureScheduleTable, executeSchedule };
