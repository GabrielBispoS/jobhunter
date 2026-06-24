import { fingerprint, deduplicateJobs, similarity } from '../dedup';
import { Job } from '../types';

function makeJob(title: string, company: string, overrides: Partial<Job> = {}): Job {
  return {
    id: `test-${title}-${company}`.replace(/\s+/g, '-').toLowerCase(),
    title,
    company,
    url: 'https://example.com/job/1',
    source: 'gupy',
    fetched_at: new Date().toISOString(),
    tags: [],
    ...overrides,
  };
}

describe('fingerprint', () => {
  it('normaliza acentos', () => {
    const a = fingerprint(makeJob('Desenvolvedor Sênior', 'Acaí Corp'));
    const b = fingerprint(makeJob('Desenvolvedor Senior', 'Acai Corp'));
    expect(a).toBe(b);
  });

  it('ignora palavras de ruído (jr, sr, pleno, developer)', () => {
    const a = fingerprint(makeJob('Java Developer Jr', 'Empresa X'));
    const b = fingerprint(makeJob('Java Sr', 'Empresa X'));
    expect(a).toBe(b);
  });

  it('ordena tokens — ordem de palavras não importa', () => {
    const a = fingerprint(makeJob('Backend Node React', 'Corp A'));
    const b = fingerprint(makeJob('React Node Backend', 'Corp A'));
    expect(a).toBe(b);
  });

  it('distingue títulos genuinamente diferentes', () => {
    const a = fingerprint(makeJob('Java Backend', 'Corp A'));
    const b = fingerprint(makeJob('Python Backend', 'Corp A'));
    expect(a).not.toBe(b);
  });

  it('distingue empresas diferentes', () => {
    const a = fingerprint(makeJob('Engenheiro', 'Nubank'));
    const b = fingerprint(makeJob('Engenheiro', 'Itau'));
    expect(a).not.toBe(b);
  });

  it('é case-insensitive', () => {
    const a = fingerprint(makeJob('Java Backend', 'NUBANK'));
    const b = fingerprint(makeJob('java backend', 'nubank'));
    expect(a).toBe(b);
  });
});

describe('deduplicateJobs', () => {
  it('remove duplicatas dentro do mesmo batch', () => {
    const jobs = [
      makeJob('Java Backend', 'Corp A'),
      makeJob('Java Backend', 'Corp A'),
      makeJob('Python Backend', 'Corp A'),
    ];
    const result = deduplicateJobs(jobs, new Set());
    expect(result).toHaveLength(2);
  });

  it('filtra vagas já existentes no banco', () => {
    const existing = makeJob('Java Backend', 'Corp A');
    const existingFps = new Set([fingerprint(existing)]);
    const jobs = [
      makeJob('Java Backend', 'Corp A'),
      makeJob('Python Backend', 'Corp A'),
    ];
    const result = deduplicateJobs(jobs, existingFps);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('Python Backend');
  });

  it('retorna todos quando não há duplicatas', () => {
    const jobs = [
      makeJob('Java Backend', 'Corp A'),
      makeJob('Node.js Frontend', 'Corp B'),
      makeJob('DevOps Engineer', 'Corp C'),
    ];
    const result = deduplicateJobs(jobs, new Set());
    expect(result).toHaveLength(3);
  });

  it('retorna lista vazia quando tudo é duplicata', () => {
    const jobs = [makeJob('Java Backend', 'Corp A')];
    const existingFps = new Set([fingerprint(jobs[0]!)]);
    const result = deduplicateJobs(jobs, existingFps);
    expect(result).toHaveLength(0);
  });

  it('trata lista vazia de entrada', () => {
    const result = deduplicateJobs([], new Set());
    expect(result).toHaveLength(0);
  });
});

describe('similarity', () => {
  it('retorna 1 para fingerprints idênticos', () => {
    const fp = fingerprint(makeJob('Java Backend', 'Corp A'));
    expect(similarity(fp, fp)).toBe(1);
  });

  it('retorna 0 para fingerprints completamente diferentes', () => {
    expect(similarity('java|backend', 'python|frontend')).toBe(0);
  });

  it('retorna valor entre 0 e 1 para fingerprints parcialmente iguais', () => {
    const s = similarity('java|backend|api', 'java|backend|python');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it('é simétrico — sim(A,B) === sim(B,A)', () => {
    const a = 'java|backend|spring';
    const b = 'java|python|backend';
    expect(similarity(a, b)).toBe(similarity(b, a));
  });

  it('trata fingerprints vazios sem explodir', () => {
    expect(() => similarity('', '')).not.toThrow();
  });
});
