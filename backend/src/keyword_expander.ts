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

// Ollama host — uses host.docker.internal when inside Docker, localhost otherwise
const OLLAMA_HOST = process.env['OLLAMA_HOST'] || 'http://host.docker.internal:11434';
const OLLAMA_MODEL = process.env['OLLAMA_MODEL'] || 'llama3.2';

const EXPANSION_PROMPT = `Você é especialista em recrutamento tech brasileiro.
Dado keywords de busca de vagas, gere variações para maximizar o alcance.

Retorne SOMENTE JSON válido, sem markdown:
{
  "groups": [["termo1","termo2"],["var1","var2"]],
  "allTerms": ["todos","os","termos","únicos"],
  "summary": "explicação curta"
}

Regras:
- 4 a 6 grupos, cada um com 2 a 4 termos equivalentes
- Cubra: título em PT e EN, variações de seniority, stack relacionado
- Termos que aparecem em títulos de vagas BR (Gupy, Catho, LinkedIn)
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
      options: {
        temperature: 0.3,
        num_predict: 600,
      },
    },
    { timeout: 30000 }
  );

  const raw: string = resp.data?.response || '';

  // Extract JSON from response (model may include extra text)
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
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const groups: string[][] = [];
  const allTerms = new Set<string>(keywords);

  const addGroup = (variants: string[]) => {
    groups.push(variants);
    variants.forEach(v => allTerms.add(v));
  };

  // Match tech synonyms
  for (const [key, variants] of Object.entries(TECH_SYNONYMS)) {
    if (input.includes(key.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
      addGroup(variants);
    }
  }

  // Match role synonyms
  for (const [key, variants] of Object.entries(ROLE_SYNONYMS)) {
    if (input.includes(key)) addGroup(variants);
  }

  // Match seniority
  for (const [key, variants] of Object.entries(SENIORITY_SYNONYMS)) {
    if (input.includes(key)) addGroup(variants);
  }

  // Always keep original as first group if nothing matched
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

export async function expandKeywords(
  keywords: string[],
  apiKey?: string
): Promise<ExpandedSearch> {
  const clean = keywords.map(k => k.trim()).filter(Boolean);

  // 1. Try Ollama first (free, local)
  try {
    const result = await expandWithOllama(clean);
    console.log(`🦙 Ollama keyword expansion: ${result.allTerms.length} terms`);
    return result;
  } catch (err: any) {
    console.log(`⚠️ Ollama unavailable (${err.message}) — trying next`);
  }

  // 2. Try Claude API if key provided
  const key = apiKey || process.env['ANTHROPIC_API_KEY'];
  if (key) {
    try {
      const result = await expandWithClaude(clean, key);
      console.log(`🤖 Claude keyword expansion: ${result.allTerms.length} terms`);
      return result;
    } catch (err: any) {
      console.log(`⚠️ Claude API failed (${err.message}) — using local fallback`);
    }
  }

  // 3. Local dictionary (always works)
  const result = localExpand(clean);
  console.log(`📚 Local keyword expansion: ${result.allTerms.length} terms`);
  return result;
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

  // Individual original terms for broad recall
  for (const term of expanded.original) {
    add([term]);
    if (queries.length >= maxQueries) break;
  }

  return queries.slice(0, maxQueries);
}

export function scoreJob(
  jobTitle: string,
  jobCompany: string,
  jobDescription: string | undefined,
  expanded: ExpandedSearch
): number {
  const normalise = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const titleN = normalise(jobTitle);
  const fullText = normalise(`${jobTitle} ${jobCompany} ${jobDescription || ''}`);
  const terms = expanded.allTerms.map(normalise);

  let score = 0;
  for (const term of terms) {
    if (titleN.includes(term)) score += 3;       // title hit = high signal
    else if (fullText.includes(term)) score += 1; // body hit = lower signal
  }

  const maxPossible = terms.length * 3;
  return maxPossible > 0 ? Math.min(100, Math.round((score / maxPossible) * 100)) : 0;
}

// Check if Ollama is available (used by health endpoint)
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
