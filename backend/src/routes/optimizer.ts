import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getJobById, getProfile } from '../db';
import { analyzeAts, generateCoverLetter, tailorCv } from '../cv_optimizer';

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
