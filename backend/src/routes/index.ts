import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { scrapeGupy, scrapeGupyCompany, KNOWN_GUPY_COMPANIES } from '../scrapers/gupy';
import { scrapeInhire, scrapeInhireCompany, KNOWN_INHIRE_COMPANIES } from '../scrapers/inhire';
import { scrapeGeekHunter } from '../scrapers/geekhunter';
import { scrapeCsod } from '../scrapers/csod';
import { scrapeRemoteOK } from '../scrapers/remoteok';
import { scrapeWeWorkRemotely } from '../scrapers/weworkremotely';
import { scrapeVagasBr, scrape99Jobs } from '../scrapers/vagas_br';
import {
  scrapeProgramathor, scrapeHipsters, scrapeApinfo, scrapeRemotar,
  scrapeTrabalha, scrapeWellfound, scrapeIndeed, scrapeDice,
  scrapeBuiltIn, scrapeZipRecruiter, scrapeMonster, scrapeRevelo,
  scrapeSolides, scrapeBne, scrapeEmpregos, scrapeCiee,
  scrapeJooble, scrapeOtta, scrapeWorkana, scrapeEmpregaBrasil, scrapeTrovit,
} from '../scrapers/global_playwright';
import { scrapeGlassdoor, scrapeCatho, scrapeInfoJobs, autoApply } from '../scrapers/playwright';
import { gupyEasyApply, parseGupyUrl } from '../scrapers/gupy_apply';
import {
  upsertJobs, getJobs, getJobById, updateJobStatus,
  createApplication, updateApplication, getApplications,
  getProfile, updateProfile, getStats, getDb, all, run as dbRun,
} from '../db';
import { SearchConfig, Job } from '../types';
import { expandKeywords, buildSearchQueries, scoreJob, checkOllama } from '../keyword_expander';
import { browserSemaphore, PLAYWRIGHT_CONCURRENCY } from '../queue';
import { deduplicateJobs, fingerprint } from '../dedup';
import { sendJobAlert, isMailConfigured } from '../mailer';
import { reloadCronJobs, ensureScheduleTable } from '../cron';

export const router = Router();

// ── Meta ──────────────────────────────────────────────────────────────────────

router.get('/stats', async (_req: Request, res: Response) => { res.json(await getStats()); });

// Expand keywords via Claude API — called by frontend before scraping
router.post('/expand-keywords', async (req: Request, res: Response) => {
  const { keywords, apiKey } = req.body as { keywords?: string[]; apiKey?: string };
  if (!keywords?.length) { res.status(400).json({ error: 'keywords required' }); return; }
  try {
    const expanded = await expandKeywords(keywords, apiKey);
    const queries = buildSearchQueries(expanded);
    res.json({ expanded, queries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sources', (_req: Request, res: Response) => {
  res.json({
    api: ['gupy','inhire','geekhunter','csod','remoteok','weworkremotely','vagas_br','99jobs'],
    browser: ['glassdoor','catho','infojobs','programathor','hipsters','apinfo','remotar',
              'trabalha_brasil','wellfound','indeed','dice','builtin','ziprecruiter','monster','revelo',
              'solides','bne','empregos_br','ciee','jooble','otta','workana','sine','trovit'],
    whitelabel: { gupy: KNOWN_GUPY_COMPANIES, inhire: KNOWN_INHIRE_COMPANIES },
    concurrency: PLAYWRIGHT_CONCURRENCY,
  });
});

router.get('/ollama-status', async (_req: Request, res: Response) => {
  const status = await checkOllama();
  res.json(status);
});

router.get('/mail-status', (_req: Request, res: Response) => {
  res.json({ configured: isMailConfigured() });
});

// ── Jobs ──────────────────────────────────────────────────────────────────────

router.get('/jobs', async (req: Request, res: Response) => {
  const { source, status, search, limit, offset } = req.query;
  res.json(await getJobs({ source: source as string|undefined, status: status as string|undefined, search: search as string|undefined, limit: limit ? Number(limit) : 50, offset: offset ? Number(offset) : 0 }));
});

router.get('/jobs/:id', async (req: Request, res: Response) => {
  const job = await getJobById(req.params['id']!);
  if (!job) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(job);
});

router.patch('/jobs/:id/status', async (req: Request, res: Response) => {
  const { status } = req.body as { status?: string };
  if (!status) { res.status(400).json({ error: 'status required' }); return; }
  await updateJobStatus(req.params['id']!, status);
  res.json({ ok: true });
});

// Delete all jobs from a specific source (useful to repopulate with fixed URLs)
router.delete('/jobs/source/:source', async (req: Request, res: Response) => {
  const db = await getDb();
  const source = req.params['source']!;
  const before = (get(db, 'SELECT COUNT(*) as n FROM jobs WHERE source = $s', { $s: source }) as any)?.n ?? 0;
  dbRun(db, 'DELETE FROM jobs WHERE source = $s', { $s: source });
  res.json({ ok: true, deleted: before });
});

// Delete ALL jobs (nuclear option — fresh start)
router.delete('/jobs/all', async (req: Request, res: Response) => {
  const db = await getDb();
  const before = (get(db, 'SELECT COUNT(*) as n FROM jobs') as any)?.n ?? 0;
  dbRun(db, 'DELETE FROM jobs');
  res.json({ ok: true, deleted: before });
});

// ── Scraper Registry ──────────────────────────────────────────────────────────

type ScraperFn = (c: SearchConfig) => Promise<{ jobs: Job[]; errors: string[]; source: string; duration_ms: number }>;

const API_SCRAPERS: Record<string, ScraperFn> = {
  gupy:           (c) => scrapeGupy(c),
  inhire:         (c) => scrapeInhire(c),
  geekhunter:     (c) => scrapeGeekHunter(c),
  remoteok:       (c) => scrapeRemoteOK(c),
  weworkremotely: (c) => scrapeWeWorkRemotely(c),
  vagas_br:       (c) => scrapeVagasBr(c),
  '99jobs':       (c) => scrape99Jobs(c),
};

const BROWSER_SCRAPERS: Record<string, ScraperFn> = {
  glassdoor:      (c) => scrapeGlassdoor(c),
  catho:          (c) => scrapeCatho(c),
  infojobs:       (c) => scrapeInfoJobs(c),
  programathor:   (c) => scrapeProgramathor(c),
  hipsters:       (c) => scrapeHipsters(c),
  apinfo:         (c) => scrapeApinfo(c),
  remotar:        (c) => scrapeRemotar(c),
  trabalha_brasil:(c) => scrapeTrabalha(c),
  wellfound:      (c) => scrapeWellfound(c),
  indeed:         (c) => scrapeIndeed(c),
  dice:           (c) => scrapeDice(c),
  builtin:        (c) => scrapeBuiltIn(c),
  ziprecruiter:   (c) => scrapeZipRecruiter(c),
  monster:        (c) => scrapeMonster(c),
  revelo:         (c) => scrapeRevelo(c),
  solides:        (c) => scrapeSolides(c),
  bne:            (c) => scrapeBne(c),
  empregos_br:    (c) => scrapeEmpregos(c),
  ciee:           (c) => scrapeCiee(c),
  jooble:         (c) => scrapeJooble(c),
  otta:           (c) => scrapeOtta(c),
  workana:        (c) => scrapeWorkana(c),
  sine:           (c) => scrapeEmpregaBrasil(c),
  trovit:         (c) => scrapeTrovit(c),
};

// ── SSE Streaming Scrape ──────────────────────────────────────────────────────

type ScrapeBody = SearchConfig & {
  apiKey?: string;
  sources?: string[];
  companies?: { gupy?: string[]; inhire?: string[]; csod?: string[] };
  notify?: boolean;
};

/**
 * POST /api/scrape/stream
 * Returns a text/event-stream.  Each event is a JSON object:
 *   { type: 'start' | 'progress' | 'done' | 'error', source, count?, total?, errors? }
 */
router.post('/scrape/stream', async (req: Request, res: Response) => {
  const config = req.body as ScrapeBody;
  if (!config.keywords?.length) { res.status(400).json({ error: 'keywords required' }); return; }

  // Expand keywords via Claude API before starting scrape
  let expandedSearch;
  try {
    expandedSearch = await expandKeywords(config.keywords, config.apiKey as string | undefined);
  } catch {
    expandedSearch = { original: config.keywords, expanded: [config.keywords], allTerms: config.keywords, summary: '' };
  }
  const searchQueries = buildSearchQueries(expandedSearch);

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  const emit = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const sources = config.sources || ['gupy', 'inhire', 'remoteok'];

  // Build full task list
  const apiTasks: Array<{ key: string; fn: ScraperFn }> = [];
  const browserTasks: Array<{ key: string; fn: ScraperFn }> = [];

  for (const s of sources) {
    if (s in API_SCRAPERS) apiTasks.push({ key: s, fn: API_SCRAPERS[s]! });
    if (s in BROWSER_SCRAPERS) browserTasks.push({ key: s, fn: BROWSER_SCRAPERS[s]! });
  }
  if (sources.includes('csod')) apiTasks.push({ key: 'csod', fn: (c) => scrapeCsod({ ...c, csodClients: config.companies?.csod }) });
  for (const slug of (config.companies?.gupy || [])) apiTasks.push({ key: `gupy:${slug}`, fn: (c) => scrapeGupyCompany(slug, c) });
  for (const slug of (config.companies?.inhire || [])) apiTasks.push({ key: `inhire:${slug}`, fn: (c) => scrapeInhireCompany(slug, c) });

  const total = apiTasks.length + browserTasks.length;
  emit({
    type: 'start', total,
    sources: [...apiTasks, ...browserTasks].map(t => t.key),
    expanded: expandedSearch,
    queries: searchQueries,
  });

  // Load existing fingerprints once for deduplication
  const db = await getDb();
  const existingRows = all(db, 'SELECT title, company FROM jobs');
  const existingFps = new Set(existingRows.map(r => fingerprint({ title: r['title'] as string, company: r['company'] as string } as Job)));

  let grandTotal = 0;
  let grandNew = 0;
  const allNewJobs: Job[] = [];

  // Run a single scraper with ALL query variations IN PARALLEL and merge results
  async function runOne(key: string, fn: ScraperFn, wrap: boolean): Promise<void> {
    const sourceStart = Date.now();
    emit({ type: 'progress', source: key, status: 'running' });
    try {
      // Run ALL search queries concurrently for this source
      // API scrapers: all queries fully parallel
      // Browser scrapers: each query still goes through semaphore (resource limit)
      const queryResults = await Promise.allSettled(
        searchQueries.map(async (queryTerms) => {
          const queryConfig = { ...config, keywords: queryTerms };
          const doRun = () => fn(queryConfig);
          return wrap ? browserSemaphore.run(doRun) : doRun();
        })
      );

      const allResults: Job[] = [];
      const allErrors: string[] = [];

      for (const r of queryResults) {
        if (r.status === 'fulfilled') {
          allResults.push(...r.value.jobs);
          allErrors.push(...r.value.errors);
        } else {
          allErrors.push(r.reason?.message || 'Unknown error');
        }
      }

      // Score each job against the full expanded term set
      for (const job of allResults) {
        (job as any)._score = scoreJob(job.title, job.company, job.description, expandedSearch);
      }

      // Sort by score descending before dedup
      allResults.sort((a, b) => ((b as any)._score || 0) - ((a as any)._score || 0));

      const mockResult = { jobs: allResults, errors: allErrors, source: key, duration_ms: Date.now() - sourceStart };
      const result = mockResult;
      const deduped = deduplicateJobs(result.jobs, existingFps);

      // Add new fingerprints so subsequent scrapers benefit too
      deduped.forEach(j => existingFps.add(fingerprint(j)));

      if (deduped.length > 0) await upsertJobs(deduped);

      grandTotal += result.jobs.length;
      grandNew += deduped.length;
      allNewJobs.push(...deduped);

      emit({
        type: 'progress', source: key, status: 'done',
        count: deduped.length, raw: result.jobs.length,
        errors: result.errors,
        duration_ms: Date.now() - sourceStart,
      });
    } catch (err: any) {
      emit({ type: 'progress', source: key, status: 'error', message: err.message });
    }
  }

  // API scrapers: all in parallel
  await Promise.all(apiTasks.map(t => runOne(t.key, t.fn, false)));

  // Browser scrapers: limited by semaphore (max 3 concurrent)
  await Promise.all(browserTasks.map(t => runOne(t.key, t.fn, true)));

  // Send email alert if requested and new jobs were found
  if (config.notify && allNewJobs.length > 0 && isMailConfigured()) {
    try {
      await sendJobAlert(allNewJobs, config.keywords, grandTotal);
      emit({ type: 'email', sent: true, to: process.env['NOTIFY_EMAIL'] });
    } catch (err: any) {
      emit({ type: 'email', sent: false, error: err.message });
    }
  }

  emit({ type: 'done', total: grandTotal, new: grandNew });
  res.end();
});

// Legacy non-streaming endpoint (kept for backwards compat / CLI use)
router.post('/scrape', async (req: Request, res: Response) => {
  const config = req.body as ScrapeBody;
  if (!config.keywords?.length) { res.status(400).json({ error: 'keywords required' }); return; }

  const sources = config.sources || ['gupy', 'inhire', 'remoteok'];
  const db = await getDb();
  const existingRows = all(db, 'SELECT title, company FROM jobs');
  const existingFps = new Set(existingRows.map(r => fingerprint({ title: r['title'] as string, company: r['company'] as string } as Job)));
  const results: Record<string, any> = {};

  const runSource = async (key: string, fn: ScraperFn, wrap: boolean) => {
    try {
      const doRun = () => fn(config);
      const r = wrap ? await browserSemaphore.run(doRun) : await doRun();
      const deduped = deduplicateJobs(r.jobs, existingFps);
      deduped.forEach(j => existingFps.add(fingerprint(j)));
      if (deduped.length) await upsertJobs(deduped);
      results[key] = { count: deduped.length, raw: r.jobs.length, errors: r.errors, duration_ms: r.duration_ms };
    } catch (err: any) {
      results[key] = { count: 0, errors: [err.message] };
    }
  };

  const apiKeys = sources.filter(s => s in API_SCRAPERS);
  const browserKeys = sources.filter(s => s in BROWSER_SCRAPERS);

  await Promise.all([
    ...apiKeys.map(s => runSource(s, API_SCRAPERS[s]!, false)),
    ...(sources.includes('csod') ? [runSource('csod', (c) => scrapeCsod({ ...c, csodClients: config.companies?.csod }), false)] : []),
    ...(config.companies?.gupy || []).map(slug => runSource(`gupy:${slug}`, (c) => scrapeGupyCompany(slug, c), false)),
    ...(config.companies?.inhire || []).map(slug => runSource(`inhire:${slug}`, (c) => scrapeInhireCompany(slug, c), false)),
  ]);

  await Promise.all(browserKeys.map(s => runSource(s, BROWSER_SCRAPERS[s]!, true)));

  res.json({ ok: true, results });
});

// ── Applications ──────────────────────────────────────────────────────────────

router.get('/applications', async (req: Request, res: Response) => {
  res.json(await getApplications({ status: req.query['status'] as string|undefined }));
});

router.post('/applications', async (req: Request, res: Response) => {
  const { job_id, notes, cover_letter } = req.body as { job_id?: string; notes?: string; cover_letter?: string };
  if (!job_id) { res.status(400).json({ error: 'job_id required' }); return; }
  await createApplication({ id: uuid(), job_id, status: 'pending', notes, cover_letter });
  res.json({ ok: true });
});

router.patch('/applications/:id', async (req: Request, res: Response) => {
  await updateApplication(req.params['id']!, req.body);
  res.json({ ok: true });
});

router.post('/apply/:jobId', async (req: Request, res: Response) => {
  const job = await getJobById(req.params['jobId']!) as any;
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  const profile = await getProfile();
  if (!profile?.email || !profile?.name) {
    res.status(400).json({ error: 'Complete seu perfil (nome + email) antes de candidatar-se' }); return;
  }

  const applyUrl: string = job.apply_url || job.url;

  try {
    // ── Gupy Easy Apply (no login needed) ─────────────────────────────────
    if (job.source === 'gupy') {
      const gupyInfo = parseGupyUrl(applyUrl);
      if (gupyInfo) {
        const result = await gupyEasyApply({
          jobId: gupyInfo.jobId,
          companySlug: gupyInfo.companySlug,
          profile: {
            name: profile.name!,
            email: profile.email!,
            phone: profile.phone || '',
            linkedin: profile.linkedin,
            resume_path: profile.resume_path,
          },
        });

        if (result.success && result.method === 'easy_apply') {
          await createApplication({
            id: uuid(), job_id: job.id, status: 'applied',
            applied_at: new Date().toISOString(),
            notes: `Gupy Easy Apply${result.application_id ? ' · ID: ' + result.application_id : ''}`,
          });
        }

        res.json({
          success: result.success,
          method: result.method,
          message: result.message,
          apply_url: result.apply_url,
          application_id: result.application_id,
        });
        return;
      }
    }

    // ── Playwright form-fill (other sources) ──────────────────────────────
    const result = await autoApply({
      applyUrl,
      profile: {
        name: profile.name!, email: profile.email!,
        phone: profile.phone || '',
        linkedin: profile.linkedin,
        resume_path: profile.resume_path,
      },
      answers: req.body.answers,
    });

    if (result.success) {
      await createApplication({
        id: uuid(), job_id: job.id, status: 'applied',
        applied_at: new Date().toISOString(),
        notes: 'Auto-applied via Playwright',
      });
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Schedules (Cron) ──────────────────────────────────────────────────────────

router.get('/schedules', async (_req: Request, res: Response) => {
  const db = await getDb();
  ensureScheduleTable(db);
  res.json(all(db, 'SELECT * FROM search_schedules ORDER BY created_at DESC'));
});

router.post('/schedules', async (req: Request, res: Response) => {
  const db = await getDb();
  ensureScheduleTable(db);
  const { name, keywords, location, remote_only, sources, schedule, notify_email } = req.body;
  if (!name || !keywords?.length || !schedule) {
    res.status(400).json({ error: 'name, keywords e schedule são obrigatórios' }); return;
  }
  const id = uuid();
  dbRun(db, `
    INSERT INTO search_schedules (id, name, keywords, location, remote_only, sources, schedule, active, notify_email)
    VALUES ($id,$name,$keywords,$location,$remote_only,$sources,$schedule,1,$notify_email)
  `, {
    $id: id, $name: name,
    $keywords: JSON.stringify(Array.isArray(keywords) ? keywords : [keywords]),
    $location: location || null,
    $remote_only: remote_only ? 1 : 0,
    $sources: JSON.stringify(sources || ['gupy','inhire','remoteok']),
    $schedule: schedule,
    $notify_email: notify_email ? 1 : 0,
  });
  await reloadCronJobs();
  res.json({ ok: true, id });
});

router.patch('/schedules/:id', async (req: Request, res: Response) => {
  const db = await getDb();
  const { active } = req.body as { active?: boolean };
  dbRun(db, 'UPDATE search_schedules SET active = $active WHERE id = $id', {
    $active: active ? 1 : 0, $id: req.params['id']!,
  });
  await reloadCronJobs();
  res.json({ ok: true });
});

router.delete('/schedules/:id', async (req: Request, res: Response) => {
  const db = await getDb();
  dbRun(db, 'DELETE FROM search_schedules WHERE id = $id', { $id: req.params['id']! });
  await reloadCronJobs();
  res.json({ ok: true });
});

// Run a schedule immediately (for testing)
router.post('/schedules/:id/run', async (req: Request, res: Response) => {
  const db = await getDb();
  const row = get(db, 'SELECT * FROM search_schedules WHERE id = $id', { $id: req.params['id']! });
  if (!row) { res.status(404).json({ error: 'Schedule not found' }); return; }
  res.json({ ok: true, message: 'Schedule iniciado em background' });
  // Run async after response
  const { executeSchedule } = await import('../cron');
  executeSchedule(row as any).catch(console.error);
});

// ── Profile ───────────────────────────────────────────────────────────────────

router.get('/profile', async (_req: Request, res: Response) => { res.json((await getProfile()) || {}); });
router.put('/profile', async (req: Request, res: Response) => { await updateProfile(req.body); res.json({ ok: true }); });

// Helper for cron.ts
function get(db: any, sql: string, params: Record<string, any> = {}): Record<string, any> | undefined {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows[0];
}
