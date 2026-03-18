import path from 'path';
import fs from 'fs';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { Job, Application, UserProfile } from './types';

const DB_PATH = process.env['DB_PATH'] || path.join(__dirname, '../../data/jobhunter.db');

let db: SqlJsDatabase | null = null;

// Persist db to disk after every write
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

// Helper: run a statement with named params
export function run(database: SqlJsDatabase, sql: string, params: Record<string, any> = {}): void {
  database.run(sql, params);
  save();
}

// Helper: query rows
export function all(database: SqlJsDatabase, sql: string, params: Record<string, any> = {}): Record<string, any>[] {
  const stmt = database.prepare(sql);
  stmt.bind(params);
  const rows: Record<string, any>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Helper: get one row
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
      tags TEXT, status TEXT DEFAULT 'new'
    );
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', applied_at TEXT,
      notes TEXT, cover_letter TEXT, response_at TEXT, response_type TEXT,
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
  `);
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

export async function upsertJobs(jobs: Job[]): Promise<void> {
  const database = await getDb();
  for (const job of jobs) {
    run(database, `
      INSERT OR REPLACE INTO jobs
        (id, title, company, location, remote, salary, description, requirements,
         url, apply_url, source, posted_at, fetched_at, tags, status)
      VALUES
        ($id,$title,$company,$location,$remote,$salary,$description,$requirements,
         $url,$apply_url,$source,$posted_at,$fetched_at,$tags,$status)
    `, {
      $id: job.id, $title: job.title, $company: job.company,
      $location: job.location ?? null, $remote: job.remote ?? null,
      $salary: job.salary ?? null, $description: job.description ?? null,
      $requirements: JSON.stringify(job.requirements || []),
      $url: job.url, $apply_url: job.apply_url ?? null,
      $source: job.source, $posted_at: job.posted_at ?? null,
      $fetched_at: job.fetched_at,
      $tags: JSON.stringify(job.tags || []),
      $status: job.status || 'new',
    });
  }
}

export async function getJobs(filters: {
  source?: string; status?: string; search?: string; limit?: number; offset?: number;
} = {}): Promise<Record<string, any>[]> {
  const database = await getDb();
  let sql = `SELECT j.*, a.status as app_status, a.id as app_id
    FROM jobs j LEFT JOIN applications a ON j.id = a.job_id WHERE 1=1`;
  const params: Record<string, any> = {};
  if (filters.source) { sql += ' AND j.source = $source'; params['$source'] = filters.source; }
  if (filters.status) { sql += ' AND j.status = $status'; params['$status'] = filters.status; }
  if (filters.search) { sql += ' AND (j.title LIKE $search OR j.company LIKE $search)'; params['$search'] = `%${filters.search}%`; }
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

export async function createApplication(app: Omit<Application, 'created_at' | 'updated_at'>): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();
  run(database, `
    INSERT OR REPLACE INTO applications
      (id, job_id, status, applied_at, notes, cover_letter, created_at, updated_at)
    VALUES ($id,$job_id,$status,$applied_at,$notes,$cover_letter,$created_at,$updated_at)
  `, {
    $id: app.id, $job_id: app.job_id, $status: app.status,
    $applied_at: app.applied_at ?? null, $notes: app.notes ?? null,
    $cover_letter: app.cover_letter ?? null,
    $created_at: now, $updated_at: now,
  });
}

export async function updateApplication(id: string, data: Partial<Application>): Promise<void> {
  const database = await getDb();
  const fields = Object.keys(data).map((k) => `${k} = $${k}`).join(', ');
  const params: Record<string, any> = { $id: id };
  for (const [k, v] of Object.entries(data)) params[`$${k}`] = v;
  run(database, `UPDATE applications SET ${fields}, updated_at = datetime('now') WHERE id = $id`, params);
}

export async function getApplications(filters: { status?: string; limit?: number } = {}): Promise<Record<string, any>[]> {
  const database = await getDb();
  let sql = `SELECT a.*, j.title, j.company, j.location, j.source, j.url
    FROM applications a JOIN jobs j ON a.job_id = j.id WHERE 1=1`;
  const params: Record<string, any> = {};
  if (filters.status) { sql += ' AND a.status = $status'; params['$status'] = filters.status; }
  sql += ' ORDER BY a.created_at DESC LIMIT $limit';
  params['$limit'] = filters.limit || 100;
  return all(database, sql, params);
}

export async function getStats(): Promise<object> {
  const database = await getDb();
  const count = (sql: string) => (get(database, sql) as any)?.n ?? 0;
  return {
    total_jobs:         count('SELECT COUNT(*) as n FROM jobs'),
    total_applications: count('SELECT COUNT(*) as n FROM applications'),
    pending:   count("SELECT COUNT(*) as n FROM applications WHERE status='pending'"),
    applied:   count("SELECT COUNT(*) as n FROM applications WHERE status='applied'"),
    interview: count("SELECT COUNT(*) as n FROM applications WHERE status='interview'"),
    rejected:  count("SELECT COUNT(*) as n FROM applications WHERE status='rejected'"),
    offer:     count("SELECT COUNT(*) as n FROM applications WHERE status='offer'"),
    by_source: all(database, 'SELECT source, COUNT(*) as n FROM jobs GROUP BY source'),
  };
}

// ── Profile ───────────────────────────────────────────────────────────────────

export async function getProfile(): Promise<UserProfile | undefined> {
  const database = await getDb();
  const row = get(database, 'SELECT * FROM profile WHERE id = 1');
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

export async function updateProfile(data: Partial<UserProfile>): Promise<void> {
  const database = await getDb();
  const serialized: Record<string, any> = {
    ...data,
    skills:              JSON.stringify(data.skills || []),
    target_roles:        JSON.stringify(data.target_roles || []),
    target_locations:    JSON.stringify(data.target_locations || []),
    blacklist_companies: JSON.stringify(data.blacklist_companies || []),
    keywords:            JSON.stringify(data.keywords || []),
    updated_at:          new Date().toISOString(),
  };
  const fields = Object.keys(serialized).map((k) => `${k} = $${k}`).join(', ');
  const params: Record<string, any> = {};
  for (const [k, v] of Object.entries(serialized)) params[`$${k}`] = v;
  run(database, `UPDATE profile SET ${fields} WHERE id = 1`, params);
}
