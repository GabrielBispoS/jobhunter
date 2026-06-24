import { Router, Request, Response } from 'express';
import { z } from 'zod';
import axios from 'axios';
import { getJobById, getProfile } from '../db';
import { analyzeAts, generateCoverLetter, tailorCv, generateInterviewQuestions, researchCompany } from '../cv_optimizer';

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const CLAUDE_HEADERS = (key: string) => ({
  'x-api-key': key,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'pdfs-2024-09-25',
  'content-type': 'application/json',
});

export const optimizerRouter = Router();

const ApiKeySchema = z.object({ apiKey: z.string().max(500).optional() });

optimizerRouter.get('/jobs/:id/ats', async (req: Request, res: Response) => {
  const job = await getJobById(req.params['id']!);
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  const profile = await getProfile();
  if (!profile) { res.status(400).json({ error: 'Configure seu perfil antes de analisar' }); return; }
  try {
    const result = analyzeAts(job, profile);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

optimizerRouter.post('/jobs/:id/cover-letter', async (req: Request, res: Response) => {
  const body = ApiKeySchema.safeParse(req.body);
  const job = await getJobById(req.params['id']!);
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  const profile = await getProfile();
  if (!profile) { res.status(400).json({ error: 'Configure seu perfil antes de gerar carta' }); return; }
  try {
    const letter = await generateCoverLetter(job, profile, body.success ? body.data.apiKey : undefined);
    res.json({ cover_letter: letter });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

optimizerRouter.post('/jobs/:id/company-insights', async (req: Request, res: Response) => {
  const body = ApiKeySchema.safeParse(req.body);
  const job = await getJobById(req.params['id']!);
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  try {
    const insights = await researchCompany(
      job['company'] as string,
      job['title'] as string,
      body.success ? body.data.apiKey : undefined
    );
    res.json(insights);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

optimizerRouter.post('/jobs/:id/interview-questions', async (req: Request, res: Response) => {
  const body = ApiKeySchema.safeParse(req.body);
  const job = await getJobById(req.params['id']!);
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  const profile = await getProfile();
  if (!profile) { res.status(400).json({ error: 'Configure seu perfil antes de gerar perguntas' }); return; }
  try {
    const questions = await generateInterviewQuestions(job, profile, body.success ? body.data.apiKey : undefined);
    res.json({ questions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

optimizerRouter.post('/jobs/:id/tailor-cv', async (req: Request, res: Response) => {
  const body = ApiKeySchema.safeParse(req.body);
  const job = await getJobById(req.params['id']!);
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  const profile = await getProfile();
  if (!profile) { res.status(400).json({ error: 'Configure seu perfil antes de adaptar CV' }); return; }
  try {
    const result = await tailorCv(job, profile, body.success ? body.data.apiKey : undefined);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const CvAnalyzeSchema = z.object({
  pdfBase64: z.string().min(100).max(20_000_000),
  apiKey: z.string().max(500).optional(),
});

optimizerRouter.post('/cv/analyze', async (req: Request, res: Response) => {
  const parsed = CvAnalyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Envie { pdfBase64: "..." } com o PDF em base64.' });
    return;
  }
  const key = parsed.data.apiKey || process.env['ANTHROPIC_API_KEY'];
  if (!key) {
    res.status(400).json({ error: 'Configure ANTHROPIC_API_KEY no .env do backend.' });
    return;
  }
  try {
    const resp = await axios.post(CLAUDE_API, {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: 'Analise o currículo e responda APENAS com JSON válido, sem texto extra:\n{"nome":"...","cargo_atual":"...","anos_experiencia":N,"skills":["..."],"roles":["cargo1","cargo2","cargo3"],"keywords":["k1","k2",...],"nivel":"junior|pleno|senior|especialista","resumo_ia":"2-3 frases sobre o perfil"}\nSkills: tecnologias, linguagens, frameworks. Roles: cargos como aparecem em vagas no Brasil. Keywords: 10 termos para buscas em plataformas como Gupy e Catho.',
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: parsed.data.pdfBase64 } },
          { type: 'text', text: 'Analise e retorne o JSON.' },
        ],
      }],
    }, { headers: CLAUDE_HEADERS(key), timeout: 60000 });

    const text: string = (resp.data.content || []).find((b: any) => b.type === 'text')?.text || '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    try {
      res.json(JSON.parse(cleaned));
    } catch {
      res.json({ raw: text });
    }
  } catch (err: any) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});
