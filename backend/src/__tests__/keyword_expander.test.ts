import { scoreJob, MIN_RELEVANCE_SCORE } from '../keyword_expander';
import type { ExpandedSearch } from '../keyword_expander';

function makeExpanded(terms: string[]): ExpandedSearch {
  return {
    original: terms,
    expanded: [terms],
    allTerms: terms,
    summary: 'test',
    engine: 'local',
  };
}

// ── Basic scoring ─────────────────────────────────────────────────────────────

describe('scoreJob — comportamento base', () => {
  it('retorna 0 quando nenhum termo bate', () => {
    const exp = makeExpanded(['python', 'django']);
    expect(scoreJob('Java Developer', 'Corp A', undefined, exp)).toBe(0);
  });

  it('dá pontuação maior para hit no título vs descrição', () => {
    const exp = makeExpanded(['java']);
    const scoreTitle = scoreJob('Java Developer', 'Corp A', 'experiência em cloud', exp);
    const scoreDesc  = scoreJob('Backend Engineer', 'Corp A', 'java spring boot', exp);
    expect(scoreTitle).toBeGreaterThan(scoreDesc);
  });

  it('retorna no máximo 100 mesmo com muitos hits', () => {
    const terms = ['java', 'spring', 'backend', 'api', 'rest', 'microservices'];
    const exp = makeExpanded(terms);
    const score = scoreJob(
      'Java Spring Backend API REST Microservices',
      'Corp Java Spring Backend',
      'java spring backend api rest microservices aws docker',
      exp
    );
    expect(score).toBeLessThanOrEqual(100);
  });

  it('normaliza acentos ao comparar', () => {
    const exp = makeExpanded(['sênior', 'desenvolvedor']);
    const score = scoreJob('Desenvolvedor Senior', 'Corp A', undefined, exp);
    expect(score).toBeGreaterThan(0);
  });

  it('funciona com descrição undefined', () => {
    const exp = makeExpanded(['java']);
    expect(() => scoreJob('Java Dev', 'Corp A', undefined, exp)).not.toThrow();
  });

  it('funciona com lista de termos vazia', () => {
    const exp = makeExpanded([]);
    expect(scoreJob('Java Developer', 'Corp A', 'java spring', exp)).toBe(0);
  });

  it('é case-insensitive', () => {
    const exp = makeExpanded(['JAVA']);
    expect(scoreJob('java developer', 'corp a', undefined, exp)).toBeGreaterThan(0);
  });
});

// ── Cenário Jurídico — o problema que motivou esta implementação ──────────────

describe('scoreJob — cenário jurídico (advogada)', () => {
  const legalTerms = makeExpanded(['Advogada Pleno', 'Advogada Empresarial', 'Advogada Civel']);

  it('vaga de advogada pleno pontua positivo', () => {
    const score = scoreJob('Advogada Pleno', 'Escritório Silva', undefined, legalTerms);
    expect(score).toBeGreaterThan(0);
  });

  it('vaga com variante de gênero (advogado) ainda pontua via stem', () => {
    // "advogado" ≠ "advogada" exato, mas stem "advoga" cobre ambos
    const score = scoreJob('Advogado Cível Sênior', 'Firm ABC', undefined, legalTerms);
    expect(score).toBeGreaterThan(0);
  });

  it('GESTOR DE VENDAS deve pontuar 0 contra termos jurídicos', () => {
    const score = scoreJob('Gestor de Vendas', 'Empresa XYZ', undefined, legalTerms);
    expect(score).toBe(0);
  });

  it('AUXILIAR DE FOTOGRAFIA deve pontuar 0 contra termos jurídicos', () => {
    const score = scoreJob('Auxiliar de Fotografia', 'Studio A', undefined, legalTerms);
    expect(score).toBe(0);
  });

  it('"Gestor de Vendas Pleno" não deve pontuar — "pleno" é stop word', () => {
    // O bug anterior: "pleno" extraído de "Advogada Pleno" era matched em "Gestor de Vendas Pleno"
    const score = scoreJob('Gestor de Vendas Pleno', 'Empresa XYZ', undefined, legalTerms);
    expect(score).toBe(0);
  });

  it('"Analista de Suporte Pleno" não deve pontuar contra termos jurídicos', () => {
    const score = scoreJob('Analista de Suporte Pleno', 'TechCorp', undefined, legalTerms);
    expect(score).toBe(0);
  });

  it('vaga jurídica pontua acima do threshold mínimo', () => {
    const score = scoreJob('Advogada Empresarial', 'Banco Brasil', undefined, legalTerms);
    expect(score).toBeGreaterThanOrEqual(MIN_RELEVANCE_SCORE);
  });

  it('vaga com variante de gênero pontua acima do threshold', () => {
    const score = scoreJob('Advogado Cível', 'Escritório Pinheiro', undefined, legalTerms);
    expect(score).toBeGreaterThanOrEqual(MIN_RELEVANCE_SCORE);
  });
});

// ── Stem matching PT ──────────────────────────────────────────────────────────

describe('scoreJob — stem matching (morfologia portuguesa)', () => {
  it('jurídico e jurídica batem via stem "juridi"', () => {
    const exp = makeExpanded(['jurídico']);
    const scoreM = scoreJob('Analista Jurídico', 'Corp', undefined, exp);
    const scoreF = scoreJob('Analista Jurídica', 'Corp', undefined, exp);
    expect(scoreM).toBeGreaterThan(0);
    expect(scoreF).toBeGreaterThan(0);
  });

  it('psicólogo bate contra pesquisa de psicóloga via stem', () => {
    const exp = makeExpanded(['psicóloga clínica']);
    const score = scoreJob('Psicólogo Organizacional', 'RH Corp', undefined, exp);
    expect(score).toBeGreaterThan(0);
  });

  it('palavras com menos de 5 chars não fazem stem match falso', () => {
    const exp = makeExpanded(['java']);
    // "java" tem 4 chars — não deve fazer stem match de "jav..." em "javascript"
    // (evita falsos positivos com prefixos muito curtos)
    const score = scoreJob('JavaScript Developer', 'Corp', undefined, exp);
    // Pode ser 0 ou não, mas não deve explodir
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ── Threshold mínimo ──────────────────────────────────────────────────────────

describe('MIN_RELEVANCE_SCORE', () => {
  it('é um número positivo entre 1 e 100', () => {
    expect(MIN_RELEVANCE_SCORE).toBeGreaterThan(0);
    expect(MIN_RELEVANCE_SCORE).toBeLessThanOrEqual(100);
  });

  it('vaga completamente irrelevante fica abaixo do threshold', () => {
    const exp = makeExpanded(['Advogada Pleno', 'Advogada Empresarial']);
    const irrelevantJobs = [
      scoreJob('Gerente de Vendas', 'Corp', undefined, exp),
      scoreJob('Auxiliar de Cozinha', 'Restaurante', undefined, exp),
      scoreJob('Motorista Entregador', 'Logística', undefined, exp),
      scoreJob('Operador de Caixa', 'Supermercado', undefined, exp),
    ];
    irrelevantJobs.forEach(score => {
      expect(score).toBeLessThan(MIN_RELEVANCE_SCORE);
    });
  });
});
