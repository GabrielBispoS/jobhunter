import { scoreJob } from '../keyword_expander';
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

describe('scoreJob', () => {
  it('retorna 0 quando nenhum termo bate', () => {
    const exp = makeExpanded(['python', 'django']);
    const score = scoreJob('Java Developer', 'Corp A', undefined, exp);
    expect(score).toBe(0);
  });

  it('dá pontuação maior para hit no título vs descrição', () => {
    const exp = makeExpanded(['java']);
    const scoreTitle = scoreJob('Java Developer', 'Corp A', 'experiência em cloud', exp);
    const scoreDesc  = scoreJob('Backend Engineer', 'Corp A', 'java spring boot', exp);
    expect(scoreTitle).toBeGreaterThan(scoreDesc);
  });

  it('retorna 100 no máximo mesmo com muitos hits', () => {
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
    const score = scoreJob('Java Developer', 'Corp A', 'java spring', exp);
    expect(score).toBe(0);
  });

  it('é case-insensitive', () => {
    const exp = makeExpanded(['JAVA']);
    const score = scoreJob('java developer', 'corp a', undefined, exp);
    expect(score).toBeGreaterThan(0);
  });
});
