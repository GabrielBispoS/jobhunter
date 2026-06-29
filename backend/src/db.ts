import path from 'path';
import fs from 'fs';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { Job, Application, UserProfile } from './types';

const DB_PATH = process.env['DB_PATH'] || path.join(__dirname, '../../data/jobhunter.db');

let db: SqlJsDatabase | null = null;

export function save(): void {
  if (!db) return;
  const data = db.export();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export async function getDb(): Promise<SqlJsDatabase> {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  initSchema(db);
  save();
  return db;
}

export function run(database: SqlJsDatabase, sql: string, params: Record<string, any> = {}): void {
  database.run(sql, params);
  save();
}

export function all(database: SqlJsDatabase, sql: string, params: Record<string, any> = {}): Record<string, any>[] {
  const stmt = database.prepare(sql);
  stmt.bind(params);
  const rows: Record<string, any>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function get(database: SqlJsDatabase, sql: string, params: Record<string, any> = {}): Record<string, any> | undefined {
  const rows = all(database, sql, params);
  return rows[0];
}

function initSchema(database: SqlJsDatabase): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, company TEXT NOT NULL,
      location TEXT, remote TEXT, salary TEXT, description TEXT,
      requirements TEXT, url TEXT NOT NULL, apply_url TEXT,
      source TEXT NOT NULL, posted_at TEXT, fetched_at TEXT NOT NULL,
      tags TEXT, status TEXT DEFAULT 'new',
      language TEXT, salary_min INTEGER, salary_max INTEGER
    );
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', applied_at TEXT,
      notes TEXT, cover_letter TEXT, response_at TEXT, response_type TEXT,
      follow_up_at TEXT, follow_up_sent INTEGER DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT, email TEXT, phone TEXT, linkedin TEXT, github TEXT,
      portfolio TEXT, resume_path TEXT, summary TEXT, skills TEXT,
      experience TEXT, education TEXT, target_roles TEXT,
      target_locations TEXT, min_salary INTEGER,
      blacklist_companies TEXT, keywords TEXT, updated_at TEXT
    );
    INSERT OR IGNORE INTO profile (id, updated_at) VALUES (1, datetime('now'));
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      name TEXT, email TEXT, phone TEXT, linkedin TEXT, github TEXT,
      portfolio TEXT, resume_path TEXT, summary TEXT, skills TEXT,
      experience TEXT, education TEXT, target_roles TEXT,
      target_locations TEXT, min_salary INTEGER,
      blacklist_companies TEXT, keywords TEXT, updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_fetched_at ON jobs(fetched_at);
    CREATE INDEX IF NOT EXISTS idx_apps_status ON applications(status);
  `);
  runMigrations(database);
}

function runMigrations(database: SqlJsDatabase): void {
  const migrations = [
    'ALTER TABLE jobs ADD COLUMN language TEXT',
    'ALTER TABLE jobs ADD COLUMN salary_min INTEGER',
    'ALTER TABLE jobs ADD COLUMN salary_max INTEGER',
    'ALTER TABLE applications ADD COLUMN follow_up_at TEXT',
    'ALTER TABLE applications ADD COLUMN follow_up_sent INTEGER DEFAULT 0',
    'ALTER TABLE applications ADD COLUMN user_id TEXT DEFAULT \'default\'',
    'ALTER TABLE jobs ADD COLUMN user_id TEXT DEFAULT \'default\'',
    // Copy legacy single-user profile to user_profiles as 'default' user
    `INSERT OR IGNORE INTO user_profiles
       SELECT 'default', name, email, phone, linkedin, github, portfolio,
              resume_path, summary, skills, experience, education,
              target_roles, target_locations, min_salary,
              blacklist_companies, keywords, updated_at
       FROM profile WHERE id = 1`,
  ];
  for (const sql of migrations) {
    try { database.run(sql); } catch { /* already applied */ }
  }
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

export async function upsertJobs(userId: string, jobs: Job[]): Promise<void> {
  const database = await getDb();
  const sql = `
    INSERT OR REPLACE INTO jobs
      (id, user_id, title, company, location, remote, salary, salary_min, salary_max,
       language, description, requirements, url, apply_url, source,
       posted_at, fetched_at, tags, status)
    VALUES
      ($id,$user_id,$title,$company,$location,$remote,$salary,$salary_min,$salary_max,
       $language,$description,$requirements,$url,$apply_url,$source,
       $posted_at,$fetched_at,$tags,$status)
  `;
  database.run('BEGIN');
  for (const job of jobs) {
    database.run(sql, {
      $id: `${userId}:${job.id}`, $user_id: userId,
      $title: job.title, $company: job.company,
      $location: job.location ?? null, $remote: job.remote ?? null,
      $salary: job.salary ?? null,
      $salary_min: job.salary_min ?? null,
      $salary_max: job.salary_max ?? null,
      $language: job.language ?? null,
      $description: job.description ?? null,
      $requirements: JSON.stringify(job.requirements || []),
      $url: job.url, $apply_url: job.apply_url ?? null,
      $source: job.source, $posted_at: job.posted_at ?? null,
      $fetched_at: job.fetched_at,
      $tags: JSON.stringify(job.tags || []),
      $status: job.status || 'new',
    });
  }
  database.run('COMMIT');
  save();
}

export async function getJobs(userId: string, filters: {
  source?: string; status?: string; search?: string; limit?: number; offset?: number;
  salary_min?: number; remote?: string; language?: string;
} = {}): Promise<Record<string, any>[]> {
  const database = await getDb();
  let sql = `SELECT j.*, a.status as app_status, a.id as app_id
    FROM jobs j LEFT JOIN applications a ON j.id = a.job_id AND a.user_id = $userId
    WHERE j.user_id = $userId`;
  const params: Record<string, any> = { $userId: userId };
  if (filters.source) { sql += ' AND j.source = $source'; params['$source'] = filters.source; }
  if (filters.status) { sql += ' AND j.status = $status'; params['$status'] = filters.status; }
  if (filters.search) { sql += ' AND (j.title LIKE $search OR j.company LIKE $search)'; params['$search'] = `%${filters.search}%`; }
  if (filters.salary_min) { sql += ' AND (j.salary_min >= $salary_min OR j.salary_max >= $salary_min)'; params['$salary_min'] = filters.salary_min; }
  if (filters.remote) { sql += ' AND j.remote = $remote'; params['$remote'] = filters.remote; }
  if (filters.language) { sql += ' AND j.language = $language'; params['$language'] = filters.language; }
  sql += ' ORDER BY j.fetched_at DESC LIMIT $limit OFFSET $offset';
  params['$limit'] = filters.limit || 50;
  params['$offset'] = filters.offset || 0;
  return all(database, sql, params);
}

export async function getJobById(id: string): Promise<Record<string, any> | undefined> {
  const database = await getDb();
  return get(database, 'SELECT * FROM jobs WHERE id = $id', { $id: id });
}

export async function updateJobStatus(id: string, status: string): Promise<void> {
  const database = await getDb();
  run(database, 'UPDATE jobs SET status = $status WHERE id = $id', { $status: status, $id: id });
}

// ── Applications ──────────────────────────────────────────────────────────────

export async function createApplication(userId: string, app: Omit<Application, 'created_at' | 'updated_at'>): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();
  run(database, `
    INSERT OR REPLACE INTO applications
      (id, job_id, status, applied_at, notes, cover_letter, follow_up_at, created_at, updated_at, user_id)
    VALUES ($id,$job_id,$status,$applied_at,$notes,$cover_letter,$follow_up_at,$created_at,$updated_at,$user_id)
  `, {
    $id: app.id, $job_id: app.job_id, $status: app.status,
    $applied_at: app.applied_at ?? null, $notes: app.notes ?? null,
    $cover_letter: app.cover_letter ?? null,
    $follow_up_at: app.follow_up_at ?? null,
    $created_at: now, $updated_at: now,
    $user_id: userId,
  });
}

const ALLOWED_APP_FIELDS = new Set(['status', 'applied_at', 'notes', 'cover_letter', 'response_at', 'response_type', 'follow_up_at', 'follow_up_sent']);

export async function updateApplication(userId: string, id: string, data: Partial<Application>): Promise<void> {
  const database = await getDb();
  const safeEntries = Object.entries(data).filter(([k]) => ALLOWED_APP_FIELDS.has(k));
  if (safeEntries.length === 0) return;
  const fields = safeEntries.map(([k]) => `${k} = $${k}`).join(', ');
  const params: Record<string, any> = { $id: id, $user_id: userId };
  for (const [k, v] of safeEntries) params[`$${k}`] = v;
  run(database, `UPDATE applications SET ${fields}, updated_at = datetime('now') WHERE id = $id AND user_id = $user_id`, params);
}

export async function getApplications(userId: string, filters: { status?: string; limit?: number } = {}): Promise<Record<string, any>[]> {
  const database = await getDb();
  let sql = `SELECT a.*, j.title, j.company, j.location, j.source, j.url
    FROM applications a JOIN jobs j ON a.job_id = j.id WHERE a.user_id = $user_id`;
  const params: Record<string, any> = { $user_id: userId };
  if (filters.status) { sql += ' AND a.status = $status'; params['$status'] = filters.status; }
  sql += ' ORDER BY a.created_at DESC LIMIT $limit';
  params['$limit'] = filters.limit || 100;
  return all(database, sql, params);
}

export async function getStats(userId: string): Promise<object> {
  const database = await getDb();
  const count = (sql: string, params?: Record<string, any>) => (get(database, sql, params) as any)?.n ?? 0;
  return {
    total_jobs:         count('SELECT COUNT(*) as n FROM jobs WHERE user_id = $uid', { $uid: userId }),
    total_applications: count('SELECT COUNT(*) as n FROM applications WHERE user_id = $uid', { $uid: userId }),
    pending:   count("SELECT COUNT(*) as n FROM applications WHERE status='pending' AND user_id = $uid", { $uid: userId }),
    applied:   count("SELECT COUNT(*) as n FROM applications WHERE status='applied' AND user_id = $uid", { $uid: userId }),
    interview: count("SELECT COUNT(*) as n FROM applications WHERE status='interview' AND user_id = $uid", { $uid: userId }),
    rejected:  count("SELECT COUNT(*) as n FROM applications WHERE status='rejected' AND user_id = $uid", { $uid: userId }),
    offer:     count("SELECT COUNT(*) as n FROM applications WHERE status='offer' AND user_id = $uid", { $uid: userId }),
    ghosted:   count("SELECT COUNT(*) as n FROM applications WHERE status='ghosted' AND user_id = $uid", { $uid: userId }),
    by_source: all(database, 'SELECT source, COUNT(*) as n FROM jobs WHERE user_id = $uid GROUP BY source', { $uid: userId }),
  };
}

export async function getApplicationStats(userId: string): Promise<object> {
  const database = await getDb();
  const count = (sql: string, params?: Record<string,any>) => (get(database, sql, params) as any)?.n ?? 0;
  const val   = (sql: string, params?: Record<string,any>) => (get(database, sql, params) as any)?.v ?? null;

  const p = { $uid: userId };
  const applied   = count("SELECT COUNT(*) as n FROM applications WHERE status IN ('applied','interview','offer','rejected','ghosted') AND user_id = $uid", p);
  const responded = count("SELECT COUNT(*) as n FROM applications WHERE response_at IS NOT NULL AND user_id = $uid", p);
  const interview = count("SELECT COUNT(*) as n FROM applications WHERE status='interview' AND user_id = $uid", p);
  const offer     = count("SELECT COUNT(*) as n FROM applications WHERE status='offer' AND user_id = $uid", p);
  const ghosted   = count("SELECT COUNT(*) as n FROM applications WHERE status='ghosted' AND user_id = $uid", p);

  const avgDaysToResponse = val(`
    SELECT ROUND(AVG((julianday(response_at) - julianday(applied_at))), 1) as v
    FROM applications WHERE response_at IS NOT NULL AND applied_at IS NOT NULL AND user_id = $uid
  `, p);

  const byWeek = all(database, `
    SELECT strftime('%Y-W%W', applied_at) as week, COUNT(*) as n
    FROM applications WHERE applied_at IS NOT NULL AND user_id = $uid
    GROUP BY week ORDER BY week DESC LIMIT 8
  `, p);

  const byStatus = all(database, `
    SELECT status, COUNT(*) as n FROM applications WHERE user_id = $uid GROUP BY status ORDER BY n DESC
  `, p);

  return {
    applied,
    responded,
    interview,
    offer,
    ghosted,
    response_rate: applied > 0 ? Math.round((responded / applied) * 100) : 0,
    interview_rate: applied > 0 ? Math.round((interview / applied) * 100) : 0,
    offer_rate: applied > 0 ? Math.round((offer / applied) * 100) : 0,
    avg_days_to_response: avgDaysToResponse,
    by_week: byWeek.reverse(),
    by_status: byStatus,
  };
}

export async function archiveOldJobs(daysOld = 45): Promise<number> {
  const database = await getDb();
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  const before = (get(database, `
    SELECT COUNT(*) as n FROM jobs
    WHERE status = 'new' AND fetched_at < $cutoff
    AND id NOT IN (SELECT job_id FROM applications)
  `, { $cutoff: cutoff }) as any)?.n ?? 0;
  run(database, `
    DELETE FROM jobs
    WHERE status = 'new' AND fetched_at < $cutoff
    AND id NOT IN (SELECT job_id FROM applications)
  `, { $cutoff: cutoff });
  return before;
}

// ── Profile ───────────────────────────────────────────────────────────────────

const ALLOWED_PROFILE_FIELDS = new Set([
  'name','email','phone','linkedin','github','portfolio','resume_path','summary',
  'skills','experience','education','target_roles','target_locations','min_salary',
  'blacklist_companies','keywords',
]);

const ARRAY_PROFILE_FIELDS = new Set(['skills','target_roles','target_locations','blacklist_companies','keywords']);

export async function getProfile(userId: string): Promise<UserProfile | undefined> {
  const database = await getDb();
  const row = get(database, 'SELECT * FROM user_profiles WHERE user_id = $uid', { $uid: userId });
  if (!row) return undefined;
  return {
    ...row,
    skills:              JSON.parse((row['skills'] as string) || '[]'),
    target_roles:        JSON.parse((row['target_roles'] as string) || '[]'),
    target_locations:    JSON.parse((row['target_locations'] as string) || '[]'),
    blacklist_companies: JSON.parse((row['blacklist_companies'] as string) || '[]'),
    keywords:            JSON.parse((row['keywords'] as string) || '[]'),
  } as UserProfile;
}

export async function updateProfile(userId: string, data: Partial<UserProfile>): Promise<void> {
  const database = await getDb();
  const safe = Object.fromEntries(Object.entries(data).filter(([k]) => ALLOWED_PROFILE_FIELDS.has(k))) as Partial<UserProfile>;
  const serialized: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(safe)) {
    serialized[k] = ARRAY_PROFILE_FIELDS.has(k) ? JSON.stringify(Array.isArray(v) ? v : []) : v;
  }

  const fields = Object.keys(serialized);
  const allFields = ['user_id', ...fields];
  const insertCols = allFields.join(', ');
  const insertVals = allFields.map(f => f === 'user_id' ? '$user_id' : `$${f}`).join(', ');
  const updateSet = fields.map(f => `${f} = $${f}`).join(', ');

  const params: Record<string, any> = { $user_id: userId };
  for (const [k, v] of Object.entries(serialized)) params[`$${k}`] = v;

  run(database, `
    INSERT INTO user_profiles (${insertCols}) VALUES (${insertVals})
    ON CONFLICT(user_id) DO UPDATE SET ${updateSet}
  `, params);
}

// ── Follow-ups (global — cron notifies all users) ─────────────────────────────

export async function getPendingFollowUps(): Promise<Record<string, any>[]> {
  const database = await getDb();
  return all(database, `
    SELECT a.*, j.title, j.company, j.url
    FROM applications a JOIN jobs j ON a.job_id = j.id
    WHERE a.follow_up_at <= $now
      AND (a.follow_up_sent IS NULL OR a.follow_up_sent = 0)
      AND a.status IN ('applied', 'pending')
    ORDER BY a.follow_up_at ASC
  `, { $now: new Date().toISOString() });
}

export async function markFollowUpSent(id: string): Promise<void> {
  const database = await getDb();
  run(database, `UPDATE applications SET follow_up_sent = 1, updated_at = datetime('now') WHERE id = $id`, { $id: id });
}
