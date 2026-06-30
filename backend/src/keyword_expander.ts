/**
 * Keyword Expander
 *
 * Priority order:
 * 1. Ollama (local LLM — free, no API key needed)
 * 2. Claude API (if ANTHROPIC_API_KEY is set)
 * 3. Local synonym dictionary (always works, zero dependencies)
 */

import axios from 'axios';

export interface ExpandedSearch {
  original: string[];
  expanded: string[][];
  allTerms: string[];
  summary: string;
  engine: 'ollama' | 'claude' | 'local';
}

const OLLAMA_HOST = process.env['OLLAMA_HOST'] || 'http://host.docker.internal:11434';
const OLLAMA_MODEL = process.env['OLLAMA_MODEL'] || 'llama3.2';

// Minimum relevance score (0-100) for a job to be saved. Configurable via env var.
export const MIN_RELEVANCE_SCORE = parseInt(process.env['MIN_RELEVANCE_SCORE'] || '15', 10);

// Seniority/modifier words that should NOT be used as standalone matching keywords.
// They appear in many unrelated jobs and cause false positives.
const SENIORITY_STOP = new Set([
  'pleno', 'junior', 'júnior', 'junior', 'sr', 'jr', 'mid', 'senior', 'sênior',
  'trainee', 'estagiário', 'estagiario', 'especialista', 'lead', 'principal',
  'coordenador', 'gerente', 'analista', 'assistente', 'auxiliar', 'consultor',
]);

// Generic words that appear in too many job titles regardless of domain.
const GENERIC_STOP = new Set([
  'para', 'como', 'area', 'areas', 'cargo', 'vaga', 'vagas', 'nivel', 'nível',
  'com', 'sem', 'and', 'the', 'para', 'empresa', 'equipe', 'time', 'ativo',
  'novo', 'nova', 'brasil', 'brazil', 'home', 'office', 'trabalho',
]);

const ALL_STOP = new Set([...SENIORITY_STOP, ...GENERIC_STOP]);

const EXPANSION_PROMPT = `Você é especialista em recrutamento e mercado de trabalho brasileiro.
Dado keywords de busca de vagas de emprego, gere variações para maximizar o alcance nos portais de vagas.

Retorne SOMENTE JSON válido, sem markdown:
{
  "groups": [["termo1","termo2"],["var1","var2"]],
  "allTerms": ["todos","os","termos","únicos"],
  "summary": "explicação curta"
}

Regras:
- 4 a 6 grupos, cada um com 2 a 4 termos equivalentes
- Cubra: título em PT e EN, variações de cargo, sinônimos da área
- Inclua variações de gênero/número quando aplicável (ex: advogada/advogado)
- Termos que aparecem em títulos de vagas reais no Brasil (Gupy, Catho, LinkedIn, Inhire)
- allTerms = todos os termos únicos de todos os grupos`;

// ── Ollama ────────────────────────────────────────────────────────────────────

async function expandWithOllama(keywords: string[]): Promise<ExpandedSearch> {
  const input = keywords.join(', ');
  const resp = await axios.post(
    `${OLLAMA_HOST}/api/generate`,
    {
      model: OLLAMA_MODEL,
      prompt: `${EXPANSION_PROMPT}\n\nKeywords: "${input}"\n\nJSON:`,
      stream: false,
      options: { temperature: 0.3, num_predict: 600 },
    },
    { timeout: 30000 }
  );
  const raw: string = resp.data?.response || '';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Ollama returned no valid JSON');
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    original: keywords,
    expanded: parsed.groups || [keywords],
    allTerms: parsed.allTerms || keywords,
    summary: parsed.summary || `Ollama (${OLLAMA_MODEL})`,
    engine: 'ollama',
  };
}

// ── Claude API ────────────────────────────────────────────────────────────────

async function expandWithClaude(keywords: string[], apiKey: string): Promise<ExpandedSearch> {
  const input = keywords.join(', ');
  const resp = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: EXPANSION_PROMPT,
      messages: [{ role: 'user', content: `Keywords: "${input}"` }],
    },
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 15000,
    }
  );
  const text: string = resp.data?.content?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude returned no valid JSON');
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    original: keywords,
    expanded: parsed.groups || [keywords],
    allTerms: parsed.allTerms || keywords,
    summary: parsed.summary || 'Claude Haiku',
    engine: 'claude',
  };
}

// ── Local dictionary fallback ─────────────────────────────────────────────────

const TECH_SYNONYMS: Record<string, string[]> = {
  'java':         ['java', 'java developer', 'desenvolvedor java', 'java engineer', 'jvm'],
  'spring':       ['spring boot', 'spring framework', 'spring', 'java spring', 'spring mvc'],
  'python':       ['python', 'python developer', 'desenvolvedor python', 'django', 'fastapi', 'flask'],
  'javascript':   ['javascript', 'js', 'node.js', 'nodejs', 'typescript', 'ts'],
  'react':        ['react', 'reactjs', 'react.js', 'frontend react', 'react developer'],
  'angular':      ['angular', 'angularjs', 'angular developer', 'frontend angular'],
  'vue':          ['vue', 'vuejs', 'vue.js', 'vue developer'],
  'kotlin':       ['kotlin', 'android kotlin', 'mobile kotlin'],
  'swift':        ['swift', 'ios swift', 'mobile ios'],
  'golang':       ['golang', 'go', 'go developer', 'desenvolvedor go'],
  'rust':         ['rust', 'rust developer', 'sistemas rust'],
  'php':          ['php', 'php developer', 'laravel', 'symfony'],
  'ruby':         ['ruby', 'ruby on rails', 'rails', 'ruby developer'],
  'csharp':       ['c#', 'csharp', '.net', 'dotnet', 'asp.net'],
  'cpp':          ['c++', 'cpp', 'c plus plus'],
  'backend':      ['backend', 'back-end', 'back end', 'server-side', 'api developer', 'desenvolvedor backend'],
  'frontend':     ['frontend', 'front-end', 'front end', 'ui developer', 'desenvolvedor frontend'],
  'fullstack':    ['full stack', 'fullstack', 'full-stack', 'desenvolvedor full stack', 'full stack developer'],
  'mobile':       ['mobile', 'mobile developer', 'desenvolvedor mobile', 'android', 'ios'],
  'devops':       ['devops', 'sre', 'platform engineer', 'cloud engineer', 'infraestrutura', 'devops engineer'],
  'dados':        ['dados', 'data', 'data engineer', 'engenheiro de dados', 'analytics', 'data science'],
  'qa':           ['qa', 'quality assurance', 'teste', 'tester', 'analista de testes', 'sdet'],
  'aws':          ['aws', 'amazon web services', 'cloud aws', 'arquiteto aws', 'aws engineer'],
  'azure':        ['azure', 'microsoft azure', 'cloud azure', 'azure developer'],
  'gcp':          ['gcp', 'google cloud', 'cloud gcp'],
  'docker':       ['docker', 'kubernetes', 'k8s', 'containers', 'containerização'],
  'sql':          ['sql', 'banco de dados', 'database', 'dba', 'postgresql', 'mysql', 'oracle'],
  'machine learning': ['machine learning', 'ml', 'ia', 'inteligência artificial', 'deep learning', 'llm'],
  'segurança':    ['segurança', 'security', 'cybersecurity', 'pentest', 'infosec'],
};

const ROLE_SYNONYMS: Record<string, string[]> = {
  'desenvolvedor':  ['desenvolvedor', 'developer', 'engenheiro de software', 'software engineer', 'programador'],
  'developer':      ['desenvolvedor', 'developer', 'engenheiro de software', 'software engineer', 'programador'],
  'engenheiro':     ['engenheiro', 'engineer', 'desenvolvedor', 'developer'],
  'analista':       ['analista', 'analyst', 'especialista', 'consultor'],
  'arquiteto':      ['arquiteto', 'architect', 'tech lead', 'principal engineer', 'staff engineer'],
  'gerente':        ['gerente', 'manager', 'coordenador', 'head of', 'diretor técnico'],
  'tech lead':      ['tech lead', 'lider técnico', 'squad lead', 'engineering lead'],
  'scrum master':   ['scrum master', 'agile coach', 'rte', 'servant leader'],
  // Legal / Law
  'advogad':        ['advogada', 'advogado', 'advogados', 'lawyer', 'attorney', 'counsel'],
  'advogada':       ['advogada', 'advogado', 'lawyer', 'attorney', 'jurídico', 'juridico'],
  'advogado':       ['advogado', 'advogada', 'lawyer', 'attorney', 'jurídico', 'juridico'],
  'juridico':       ['jurídico', 'juridico', 'advogada', 'advogado', 'direito', 'legal'],
  'direito':        ['direito', 'jurídico', 'juridico', 'legal', 'compliance', 'legislação'],
  'compliance':     ['compliance', 'conformidade', 'regulatório', 'jurídico', 'governança'],
  // Healthcare
  'medico':         ['médico', 'medico', 'doutor', 'physician', 'clínico'],
  'enfermeiro':     ['enfermeiro', 'enfermeira', 'nurse', 'técnico de enfermagem'],
  'psicolog':       ['psicólogo', 'psicóloga', 'psicologo', 'psicologa', 'terapeuta'],
  // Finance
  'contador':       ['contador', 'contadora', 'accountant', 'contabilidade', 'fiscal'],
  'financeiro':     ['financeiro', 'financeira', 'finance', 'contabilidade', 'controladoria'],
  'economista':     ['economista', 'economist', 'finanças', 'finance'],
  // Marketing
  'marketing':      ['marketing', 'growth', 'brand', 'comunicação', 'publicidade', 'propaganda'],
  'designer':       ['designer', 'ux', 'ui', 'product designer', 'design gráfico'],
  // HR
  'rh':             ['rh', 'recursos humanos', 'hr', 'people', 'gente e gestão', 'gestão de pessoas'],
  'recursos humanos': ['recursos humanos', 'rh', 'hr', 'people', 'gestão de pessoas'],
};

const SENIORITY_SYNONYMS: Record<string, string[]> = {
  'junior':     ['junior', 'jr', 'júnior', 'trainee', 'entry level', 'estagiário'],
  'jr':         ['junior', 'jr', 'júnior', 'trainee', 'entry level'],
  'pleno':      ['pleno', 'mid', 'mid-level', 'intermediário', 'pl'],
  'senior':     ['senior', 'sr', 'sênior', 'especialista', 'lead', 'principal'],
  'sr':         ['senior', 'sr', 'sênior', 'especialista'],
  'especialista': ['especialista', 'senior', 'sr', 'principal', 'staff'],
};

function localExpand(keywords: string[]): ExpandedSearch {
  const input = keywords.join(' ').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  const groups: string[][] = [];
  const allTerms = new Set<string>(keywords);

  const addGroup = (variants: string[]) => {
    groups.push(variants);
    variants.forEach(v => allTerms.add(v));
  };

  for (const [key, variants] of Object.entries(TECH_SYNONYMS)) {
    if (input.includes(key.normalize('NFD').replace(/[̀-ͯ]/g, ''))) {
      addGroup(variants);
    }
  }
  for (const [key, variants] of Object.entries(ROLE_SYNONYMS)) {
    if (input.includes(key.normalize('NFD').replace(/[̀-ͯ]/g, ''))) {
      addGroup(variants);
    }
  }
  for (const [key, variants] of Object.entries(SENIORITY_SYNONYMS)) {
    if (input.includes(key)) addGroup(variants);
  }

  if (groups.length === 0) addGroup(keywords);

  return {
    original: keywords,
    expanded: groups,
    allTerms: [...allTerms],
    summary: `Dicionário local: ${groups.length} grupos, ${allTerms.size} termos`,
    engine: 'local',
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

const expansionCache = new Map<string, { result: ExpandedSearch; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

export async function expandKeywords(keywords: string[]): Promise<ExpandedSearch> {
  const clean = keywords.map(k => k.trim()).filter(Boolean);
  const cacheKey = clean.map(k => k.toLowerCase()).sort().join('|');

  const cached = expansionCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.result;

  let result: ExpandedSearch;

  try {
    result = await expandWithOllama(clean);
    console.log(`🦙 Ollama keyword expansion: ${result.allTerms.length} terms`);
  } catch (err: any) {
    console.log(`⚠️ Ollama unavailable (${err.message}) — trying next`);
    const key = process.env['ANTHROPIC_API_KEY'];
    if (key) {
      try {
        result = await expandWithClaude(clean, key);
        console.log(`🤖 Claude keyword expansion: ${result.allTerms.length} terms`);
      } catch (err2: any) {
        console.log(`⚠️ Claude API failed (${err2.message}) — using local fallback`);
        result = localExpand(clean);
        console.log(`📚 Local keyword expansion: ${result.allTerms.length} terms`);
      }
    } else {
      result = localExpand(clean);
      console.log(`📚 Local keyword expansion: ${result.allTerms.length} terms`);
    }
  }

  expansionCache.set(cacheKey, { result: result!, ts: Date.now() });
  return result!;
}

export function buildSearchQueries(expanded: ExpandedSearch, maxQueries = 6): string[][] {
  const queries: string[][] = [];
  const seen = new Set<string>();

  const add = (terms: string[]) => {
    const key = [...terms].sort().join('|');
    if (!seen.has(key)) { seen.add(key); queries.push(terms); }
  };

  // Original always first
  add(expanded.original);

  // Representative terms from each expansion group
  for (const group of expanded.expanded) {
    add(group.slice(0, 2));
    if (queries.length >= maxQueries) break;
  }

  // Individual original terms — only if substantive (not seniority-only words)
  for (const term of expanded.original) {
    const normTerm = term.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const words = normTerm.split(/\s+/);
    // Skip if the term is purely seniority/generic (all words are stop words)
    const isSubstantive = words.some(w => w.length >= 4 && !ALL_STOP.has(w));
    if (isSubstantive && queries.length < maxQueries) {
      add([term]);
    }
  }

  return queries.slice(0, maxQueries);
}

export function scoreJob(
  jobTitle: string,
  jobCompany: string,
  jobDescription: string | undefined,
  expanded: ExpandedSearch
): number {
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const titleN = norm(jobTitle);
  // Company name excluded from body text: generic names like "Empresa XYZ" would
  // produce false stem matches (e.g. "empresa" → stem "empres" → matches "empresarial").
  const fullText = norm(`${jobTitle} ${jobDescription || ''}`);
  const terms = expanded.allTerms.map(norm);

  if (terms.length === 0) return 0;

  // Extract unique key words from all term phrases, excluding stop words.
  // These are the semantic "role words" — e.g. "advogada" from "advogada pleno".
  const keyWords = [...new Set(
    terms.flatMap(t => t.split(/\s+/).filter(w => w.length >= 4 && !ALL_STOP.has(w)))
  )];

  const titleWords = titleN.split(/\s+/);
  const fullWords = fullText.split(/\s+/);

  let score = 0;

  for (const kw of keyWords) {
    // Stem: first 6 chars to handle PT morphology (advogada/advogado, jurídico/jurídica)
    const STEM = Math.min(kw.length, 6);
    const stem = kw.slice(0, STEM);

    if (titleN.includes(kw)) {
      // Exact phrase/word match in title — strongest signal
      score += 3;
    } else if (STEM >= 5 && titleWords.some(w => w.length >= STEM && w.startsWith(stem))) {
      // Stem match in title — handles gender/number variants (advogada↔advogado)
      score += 2;
    } else if (fullText.includes(kw)) {
      // Exact match in body/description
      score += 1;
    } else if (STEM >= 5 && fullWords.some(w => w.length >= STEM && w.startsWith(stem))) {
      // Stem match in body
      score += 0.5;
    }
  }

  const maxPossible = keyWords.length * 3;
  return maxPossible > 0 ? Math.min(100, Math.round((score / maxPossible) * 100)) : 0;
}

export async function checkOllama(): Promise<{ available: boolean; model: string; host: string }> {
  try {
    const resp = await axios.get(`${OLLAMA_HOST}/api/tags`, { timeout: 3000 });
    const models: string[] = (resp.data?.models || []).map((m: any) => m.name);
    const hasModel = models.some(m => m.startsWith(OLLAMA_MODEL));
    return { available: true, model: hasModel ? OLLAMA_MODEL : `${OLLAMA_MODEL} (não instalado — rode: ollama pull ${OLLAMA_MODEL})`, host: OLLAMA_HOST };
  } catch {
    return { available: false, model: OLLAMA_MODEL, host: OLLAMA_HOST };
  }
}
