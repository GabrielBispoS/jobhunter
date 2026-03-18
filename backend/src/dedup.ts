/**
 * Job Deduplication
 *
 * Normalises title + company into a fingerprint and detects duplicates
 * before upsert so the same role from Gupy + Inhire + CSOD doesn't
 * flood the results.
 */

import { Job } from './types';

// Tokens that add no signal for matching
const NOISE = new Set([
  'de','da','do','das','dos','e','em','para','com','na','no',
  'jr','sr','pl','pleno','junior','senior','especialista',
  'vaga','analista','desenvolvedor','developer','engineer',
  'engenheiro','gerente','coordenador','diretor','assistente',
]);

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/[^a-z0-9\s]/g, ' ')      // keep only alphanumeric
    .split(/\s+/)
    .filter(w => w.length > 1 && !NOISE.has(w))
    .sort()
    .join('|');
}

export function fingerprint(job: Job): string {
  return `${normalise(job.title)}::${normalise(job.company)}`;
}

/**
 * Given an array of freshly scraped jobs, remove duplicates within the batch
 * and also filter out those whose fingerprint already exists in the DB.
 *
 * @param jobs        — incoming jobs from one or multiple scrapers
 * @param existingFps — set of fingerprints already stored in DB
 */
export function deduplicateJobs(jobs: Job[], existingFps: Set<string>): Job[] {
  const seen = new Set<string>(existingFps);
  const unique: Job[] = [];

  for (const job of jobs) {
    const fp = fingerprint(job);
    if (!seen.has(fp)) {
      seen.add(fp);
      unique.push(job);
    }
  }

  return unique;
}

/**
 * Compute Jaccard similarity between two normalised fingerprint strings.
 * Returns 0–1 where 1 = identical.
 */
export function similarity(fpA: string, fpB: string): number {
  const a = new Set(fpA.split('|'));
  const b = new Set(fpB.split('|'));
  const intersection = [...a].filter(t => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}
