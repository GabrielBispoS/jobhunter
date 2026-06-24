import axios from 'axios';
import { Job, UserProfile } from './types';

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const CLAUDE_HEADERS = (key: string) => ({
  'x-api-key': key,
  'anthropic-version': '2023-06-01',
  'content-type': 'application/json',
});

// ── Language detection ────────────────────────────────────────────────────────

const PT_MARKERS = ['desenvolvedor','engenheiro','analista','vaga','empresa','requisitos',
  'experiência','benefícios','salário','remoto','presencial','conhecimento','habilidades',
  'candidatura','contratação','equipe'];
const EN_MARKERS = ['developer','engineer','analyst','job','company','requirements',
  'experience','benefits','salary','remote','onsite','knowledge','skills',
  'application','hiring','team','must have','nice to have','responsibilities'];

export function detectLanguage(text: string): 'pt' | 'en' {
  const lower = text.toLowerCase();
  const ptHits = PT_MARKERS.filter(w => lower.includes(w)).length;
  const enHits = EN_MARKERS.filter(w => lower.includes(w)).length;
  return enHits > ptHits ? 'en' : 'pt';
}

// ── Salary parsing ────────────────────────────────────────────────────────────

export function parseSalary(text: string | undefined): { min?: number; max?: number } {
  if (!text) return {};
  // Remove thousands separators and normalize
  const cleaned = text.replace(/\./g, '').replace(',', '.');
  const rangeMatch = cleaned.match(/(\d{3,6})(?:[^\d]+(\d{3,6}))?/);
  if (!rangeMatch) return {};
  const a = parseInt(rangeMatch[1] ?? '0', 10);
  const b = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : undefined;
  if (b && b > a && b < 1_000_000) return { min: a, max: b };
  if (a > 500 && a < 1_000_000) return { min: a };
  return {};
}

// ── ATS Score (local, no API) ─────────────────────────────────────────────────

export interface AtsResult {
  score: number;
  matched: string[];
  missing: string[];
  suggestions: string[];
  language: 'pt' | 'en';
  salary_min?: number;
  salary_max?: number;
}

export function analyzeAts(job: Record<string, any>, profile: UserProfile): AtsResult {
  const jobText = [job['title'], job['description'], job['requirements']].filter(Boolean).join(' ').toLowerCase();
  const language = detectLanguage(jobText);
  const salary = parseSalary(job['salary']);

  const profileSkills = (profile.skills || []).map(s => s.toLowerCase());
  const matched: string[] = [];
  const missing: string[] = [];

  for (const skill of profileSkills) {
    (jobText.includes(skill) ? matched : missing).push(skill);
  }

  const skillCoverage = profileSkills.length > 0 ? matched.length / profileSkills.length : 0;

  const titleText = (job['title'] || '').toLowerCase();
  const roleHits = (profile.target_roles || []).filter(r => titleText.includes((r.toLowerCase().split(' ')[0]) ?? '')).length;
  const roleScore = Math.min(1, roleHits / Math.max(1, (profile.target_roles || []).length));

  const requiredKeywords = extractRequiredKeywords(job['description'] || '');
  const profileText = [...(profile.skills || []), ...(profile.keywords || []), profile.summary || ''].join(' ').toLowerCase();
  const keywordHits = requiredKeywords.filter(k => profileText.includes(k)).length;
  const keywordScore = requiredKeywords.length > 0 ? keywordHits / requiredKeywords.length : 0.5;

  const score = Math.min(100, Math.round((skillCoverage * 60) + (roleScore * 20) + (keywordScore * 20)));

  const suggestions = buildSuggestions(score, matched, missing, language, job, profile);

  return { score, matched, missing, suggestions, language, ...salary };
}

function extractRequiredKeywords(description: string): string[] {
  const lower = description.toLowerCase();
  const required: string[] = [];
  for (const line of lower.split('\n')) {
    if (line.includes('requisito') || line.includes('required') || line.includes('must have') || line.includes('obrigatório')) {
      const words = line.match(/\b[a-z][a-z0-9+#.]{1,20}\b/g) || [];
      required.push(...words.filter(w => w.length > 2 && !STOP_WORDS.has(w)));
    }
  }
  return [...new Set(required)].slice(0, 15);
}

function buildSuggestions(
  score: number,
  matched: string[],
  missing: string[],
  language: 'pt' | 'en',
  job: Record<string, any>,
  profile: UserProfile
): string[] {
  const tips: string[] = [];
  const isPt = language === 'pt';

  if (score < 40) {
    tips.push(isPt ? 'Score baixo — considere adequar o currículo antes de se candidatar.' : 'Low score — consider tailoring your CV before applying.');
  }
  if (missing.length > 3) {
    const top = missing.slice(0, 3).join(', ');
    tips.push(isPt ? `Adicione ao currículo: ${top}` : `Add to your CV: ${top}`);
  }
  if (!profile.summary) {
    tips.push(isPt ? 'Adicione um resumo profissional ao perfil.' : 'Add a professional summary to your profile.');
  }
  if (matched.length > 0 && score < 70) {
    tips.push(isPt
      ? `Destaque no topo do CV: ${matched.slice(0, 3).join(', ')}`
      : `Highlight at top of CV: ${matched.slice(0, 3).join(', ')}`);
  }
  if (job['remote'] === 'remote' && isPt) {
    tips.push('Vaga remota — mencione experiência com trabalho assíncrono e ferramentas como Slack/Notion.');
  }
  if (score >= 70) {
    tips.push(isPt ? '✅ Bom match! Candidate-se com confiança.' : '✅ Good match! Apply with confidence.');
  }
  return tips;
}

const STOP_WORDS = new Set(['the','and','for','with','que','com','para','uma','ter','ser','nos','que','uma']);

// ── Cover Letter (Claude API) ─────────────────────────────────────────────────

export async function generateCoverLetter(
  job: Record<string, any>,
  profile: UserProfile,
  apiKey?: string
): Promise<string> {
  const key = apiKey || process.env['ANTHROPIC_API_KEY'];
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada. Adicione ao .env para usar esta função.');

  const language = detectLanguage([job['title'], job['description']].filter(Boolean).join(' '));
  const isPt = language === 'pt';

  const prompt = isPt
    ? `Escreva uma carta de apresentação profissional e concisa (máximo 250 palavras) para a seguinte vaga.
A carta deve ser em primeira pessoa, destacar as skills mais relevantes do candidato para a vaga, e terminar com uma chamada para ação.

VAGA:
Título: ${job['title']}
Empresa: ${job['company']}
Descrição: ${(job['description'] || '').slice(0, 800)}

CANDIDATO:
Nome: ${profile.name || 'Candidato'}
Skills: ${(profile.skills || []).join(', ')}
Resumo: ${profile.summary || ''}
LinkedIn: ${profile.linkedin || ''}

Retorne APENAS a carta, sem título nem explicações.`
    : `Write a professional, concise cover letter (max 250 words) for the following job.
Use first person, highlight the most relevant candidate skills, and end with a call to action.

JOB:
Title: ${job['title']}
Company: ${job['company']}
Description: ${(job['description'] || '').slice(0, 800)}

CANDIDATE:
Name: ${profile.name || 'Candidate'}
Skills: ${(profile.skills || []).join(', ')}
Summary: ${profile.summary || ''}
LinkedIn: ${profile.linkedin || ''}

Return ONLY the cover letter, no title or explanations.`;

  const resp = await axios.post(CLAUDE_API, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  }, { headers: CLAUDE_HEADERS(key), timeout: 30000 });

  return (resp.data.content?.[0]?.text || '').trim();
}

// ── Company Research (Claude API via web search context) ─────────────────────

export interface CompanyInsights {
  overview: string;
  culture_score?: number;         // 1-5 if available
  avg_salary?: string;            // salary range for the role at this company
  interview_difficulty?: string;  // Easy / Medium / Hard
  common_interview_topics: string[];
  pros: string[];
  cons: string[];
  glassdoor_tip: string;          // what to look for on Glassdoor manually
  sources_note: string;
}

export async function researchCompany(
  company: string,
  jobTitle: string,
  apiKey?: string
): Promise<CompanyInsights> {
  const key = apiKey || process.env['ANTHROPIC_API_KEY'];
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada.');

  const prompt = `Você é um assistente de carreira especializado.
Com base no seu conhecimento sobre a empresa "${company}" e a vaga "${jobTitle}", forneça informações úteis para um candidato.

Responda APENAS com JSON válido (sem texto extra):
{
  "overview": "2-3 frases sobre a empresa, cultura e porte",
  "culture_score": <número 1-5 ou null se incerto>,
  "avg_salary": "faixa salarial típica para ${jobTitle} nesta empresa ou setor (ex: R$ 8.000 – R$ 14.000)",
  "interview_difficulty": "Fácil|Médio|Difícil",
  "common_interview_topics": ["tópico técnico 1", "tópico 2", "tópico 3"],
  "pros": ["aspecto positivo 1", "aspecto positivo 2"],
  "cons": ["ponto de atenção 1", "ponto de atenção 2"],
  "glassdoor_tip": "dica específica do que verificar no Glassdoor/LinkedIn para esta empresa",
  "sources_note": "Nota: dados baseados em conhecimento geral até data de corte. Verifique Glassdoor e LinkedIn para informações atualizadas."
}

Se não tiver informações confiáveis sobre a empresa, use o setor/tamanho inferido pelo nome para dar estimativas razoáveis.
Priorize dados sobre empresas brasileiras conhecidas (Nubank, iFood, Mercado Livre, Totvs, Stefanini, etc.) se aplicável.`;

  const resp = await axios.post(CLAUDE_API, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  }, { headers: CLAUDE_HEADERS(key), timeout: 30000 });

  const raw = (resp.data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(raw) as CompanyInsights;
  } catch {
    return {
      overview: raw.slice(0, 200),
      common_interview_topics: [],
      pros: [],
      cons: [],
      glassdoor_tip: 'Pesquise a empresa no Glassdoor para avaliações de funcionários.',
      sources_note: 'Dados não puderam ser estruturados.',
    };
  }
}

// ── Interview Questions (Claude API) ─────────────────────────────────────────

export interface InterviewQuestion {
  question: string;
  category: 'behavioral' | 'technical' | 'situational' | 'culture';
  tip: string;
}

export async function generateInterviewQuestions(
  job: Record<string, any>,
  profile: UserProfile,
  apiKey?: string
): Promise<InterviewQuestion[]> {
  const key = apiKey || process.env['ANTHROPIC_API_KEY'];
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada. Adicione ao .env.');

  const language = detectLanguage([job['title'], job['description']].filter(Boolean).join(' '));
  const isPt = language === 'pt';

  const prompt = isPt
    ? `Com base na vaga e perfil abaixo, gere 7 perguntas de entrevista realistas que este candidato provavelmente enfrentará.
Responda APENAS com JSON válido — array de objetos:
[{"question":"...","category":"behavioral|technical|situational|culture","tip":"dica curta de como responder bem"}]

VAGA:
Título: ${job['title']}
Empresa: ${job['company']}
Descrição: ${(job['description'] || '').slice(0, 800)}

CANDIDATO:
Skills: ${(profile.skills || []).join(', ')}
Nível: ${(profile.summary || '').slice(0, 200)}

Mix recomendado: 2 técnicas, 2 comportamentais, 2 situacionais, 1 cultura/valores.`
    : `Based on the job and profile below, generate 7 realistic interview questions this candidate will likely face.
Respond ONLY with valid JSON — array of objects:
[{"question":"...","category":"behavioral|technical|situational|culture","tip":"short tip on how to answer well"}]

JOB:
Title: ${job['title']}
Company: ${job['company']}
Description: ${(job['description'] || '').slice(0, 800)}

CANDIDATE:
Skills: ${(profile.skills || []).join(', ')}
Level: ${(profile.summary || '').slice(0, 200)}

Recommended mix: 2 technical, 2 behavioral, 2 situational, 1 culture/values.`;

  const resp = await axios.post(CLAUDE_API, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  }, { headers: CLAUDE_HEADERS(key), timeout: 30000 });

  const raw = (resp.data.content?.[0]?.text || '[]').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(raw) as InterviewQuestion[];
  } catch {
    return [];
  }
}

// ── CV Tailoring (Claude API) ─────────────────────────────────────────────────

export interface TailorResult {
  summary: string;
  highlights: string[];
  keywords_to_add: string[];
  advice: string;
}

export async function tailorCv(
  job: Record<string, any>,
  profile: UserProfile,
  apiKey?: string
): Promise<TailorResult> {
  const key = apiKey || process.env['ANTHROPIC_API_KEY'];
  if (!key) throw new Error('ANTHROPIC_API_KEY não configurada. Adicione ao .env para usar esta função.');

  const language = detectLanguage([job['title'], job['description']].filter(Boolean).join(' '));
  const isPt = language === 'pt';

  const prompt = isPt
    ? `Analise a vaga abaixo e sugira como o candidato deve adaptar seu currículo para maximizar o match com ATS e chamar a atenção do recrutador.
Responda APENAS com JSON válido:
{"summary":"resumo de 2-3 frases focado nesta vaga","highlights":["bullet 1","bullet 2","bullet 3"],"keywords_to_add":["k1","k2","k3"],"advice":"dica estratégica de 1-2 frases"}

VAGA:
Título: ${job['title']}
Empresa: ${job['company']}
Descrição: ${(job['description'] || '').slice(0, 1000)}

PERFIL ATUAL:
Skills: ${(profile.skills || []).join(', ')}
Resumo atual: ${profile.summary || '(sem resumo)'}`
    : `Analyze the job below and suggest how the candidate should tailor their CV to maximize ATS match.
Respond ONLY with valid JSON:
{"summary":"2-3 sentence summary focused on this job","highlights":["bullet 1","bullet 2","bullet 3"],"keywords_to_add":["k1","k2","k3"],"advice":"1-2 sentence strategic tip"}

JOB:
Title: ${job['title']}
Company: ${job['company']}
Description: ${(job['description'] || '').slice(0, 1000)}

CURRENT PROFILE:
Skills: ${(profile.skills || []).join(', ')}
Current summary: ${profile.summary || '(no summary)'}`;

  const resp = await axios.post(CLAUDE_API, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  }, { headers: CLAUDE_HEADERS(key), timeout: 30000 });

  const raw = (resp.data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(raw) as TailorResult;
  } catch {
    return { summary: '', highlights: [], keywords_to_add: [], advice: raw.slice(0, 200) };
  }
}
