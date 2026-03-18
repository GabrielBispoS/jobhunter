/**
 * Playwright Concurrency Queue
 *
 * Concurrency is auto-tuned based on available CPU cores:
 *   - ≤ 2 cores  → 2 browsers
 *   - 3-4 cores  → 3 browsers  
 *   - 5-7 cores  → 4 browsers
 *   - 8+ cores   → 5 browsers
 *
 * Can be overridden via PLAYWRIGHT_CONCURRENCY env var.
 */

import os from 'os';

export class Semaphore {
  private slots: number;
  private queue: Array<() => void> = [];

  constructor(concurrency: number) {
    this.slots = concurrency;
  }

  async acquire(): Promise<void> {
    if (this.slots > 0) { this.slots--; return; }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.slots++;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }
  }

  get concurrency(): number { return this.slots + this.queue.length; }
}

function calcIdealConcurrency(): number {
  const envVal = parseInt(process.env['PLAYWRIGHT_CONCURRENCY'] || '0', 10);
  if (envVal > 0) return envVal;

  const cores = os.cpus().length;
  const totalMemGb = os.totalmem() / (1024 ** 3);

  // Each Chromium instance uses ~200-300MB RAM
  const maxByRam = Math.floor(totalMemGb / 0.5);

  let maxByCpu: number;
  if (cores <= 2) maxByCpu = 2;
  else if (cores <= 4) maxByCpu = 3;
  else if (cores <= 7) maxByCpu = 4;
  else maxByCpu = 5;

  const ideal = Math.min(maxByCpu, maxByRam, 5); // hard cap at 5
  console.log(`🖥️  CPU cores: ${cores}, RAM: ${totalMemGb.toFixed(1)}GB → Playwright concurrency: ${ideal}`);
  return Math.max(2, ideal);
}

export const PLAYWRIGHT_CONCURRENCY = calcIdealConcurrency();
export const browserSemaphore = new Semaphore(PLAYWRIGHT_CONCURRENCY);
