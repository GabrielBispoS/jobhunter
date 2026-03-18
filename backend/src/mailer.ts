/**
 * Email notifications via Nodemailer.
 * Supports any SMTP provider (Gmail, Outlook, Mailtrap, SendGrid, etc.)
 * Config comes from environment variables — no hardcoded credentials.
 */

import nodemailer, { Transporter, SendMailOptions } from 'nodemailer';
import { Job } from './types';

let _transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (_transporter) return _transporter;

  const host = process.env['SMTP_HOST'];
  const port = parseInt(process.env['SMTP_PORT'] || '587', 10);
  const user = process.env['SMTP_USER'];
  const pass = process.env['SMTP_PASS'];

  if (!host || !user || !pass) return null;

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return _transporter;
}

export function isMailConfigured(): boolean {
  return !!(
    process.env['SMTP_HOST'] &&
    process.env['SMTP_USER'] &&
    process.env['SMTP_PASS'] &&
    process.env['NOTIFY_EMAIL']
  );
}

export async function sendJobAlert(
  newJobs: Job[],
  keywords: string[],
  totalFound: number
): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) return;

  const to = process.env['NOTIFY_EMAIL']!;

  // Score & sort by match quality (jobs with more keyword hits first)
  const scored = newJobs
    .map(j => {
      const text = `${j.title} ${j.company} ${j.description || ''}`.toLowerCase();
      const hits = keywords.filter(k => text.includes(k.toLowerCase())).length;
      return { job: j, score: hits };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20); // max 20 per email

  const rows = scored.map(({ job, score }) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #222">
        <a href="${job.apply_url || job.url}" style="color:#6366f1;font-weight:600;text-decoration:none">
          ${escHtml(job.title)}
        </a><br>
        <span style="color:#888;font-size:13px">${escHtml(job.company)}</span>
      </td>
      <td style="padding:10px;border-bottom:1px solid #222;color:#888;font-size:13px">
        ${escHtml(job.location || '—')}
      </td>
      <td style="padding:10px;border-bottom:1px solid #222">
        <span style="font-family:monospace;font-size:12px;padding:2px 8px;border-radius:4px;
          background:${scoreColor(score)};color:white">${score > 0 ? score + ' match' : '—'}</span>
      </td>
      <td style="padding:10px;border-bottom:1px solid #222">
        <span style="font-size:11px;padding:2px 8px;border-radius:4px;background:#1a1a2a;color:#6366f1">
          ${escHtml(job.source)}
        </span>
      </td>
    </tr>
  `).join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>JobHunter — Novas Vagas</title></head>
<body style="margin:0;padding:0;background:#0a0a0f;color:#e8e8f0;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:700px;margin:0 auto;padding:32px 16px">

    <div style="margin-bottom:28px">
      <h1 style="font-size:24px;margin:0 0 8px;color:#6366f1">⚡ JobHunter</h1>
      <p style="margin:0;color:#888">Busca automática concluída — ${new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long' })}</p>
    </div>

    <div style="background:#111118;border:1px solid #222232;border-radius:12px;padding:20px;margin-bottom:24px">
      <div style="display:flex;gap:32px">
        <div>
          <div style="font-size:32px;font-weight:800;color:#6366f1">${totalFound}</div>
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.06em">vagas encontradas</div>
        </div>
        <div>
          <div style="font-size:32px;font-weight:800;color:#22d3ee">${newJobs.length}</div>
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.06em">novas (deduplicadas)</div>
        </div>
        <div>
          <div style="font-size:14px;font-weight:600;color:#f59e0b;margin-top:8px">${keywords.slice(0, 4).join(', ')}</div>
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.06em">keywords buscadas</div>
        </div>
      </div>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0"
      style="background:#111118;border:1px solid #222232;border-radius:12px;border-collapse:collapse;overflow:hidden">
      <thead>
        <tr style="background:#1a1a24">
          <th style="padding:12px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#666">Vaga</th>
          <th style="padding:12px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#666">Local</th>
          <th style="padding:12px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#666">Match</th>
          <th style="padding:12px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#666">Fonte</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${newJobs.length < totalFound ? `
    <p style="text-align:center;color:#666;font-size:13px;margin-top:16px">
      Mostrando as top ${scored.length} de ${newJobs.length} novas vagas.
      Acesse o dashboard para ver todas.
    </p>` : ''}

    <div style="text-align:center;margin-top:32px;padding-top:24px;border-top:1px solid #222232;color:#444;font-size:12px">
      JobHunter · Busca automática agendada<br>
      <a href="#" style="color:#6366f1">Abrir Dashboard</a>
    </div>
  </div>
</body>
</html>`;

  const mail: SendMailOptions = {
    from: `"JobHunter 🚀" <${process.env['SMTP_USER']}>`,
    to,
    subject: `⚡ ${newJobs.length} novas vagas encontradas — ${keywords.slice(0, 2).join(', ')}`,
    html,
  };

  await transporter.sendMail(mail);
  console.log(`📧 Email enviado para ${to} (${newJobs.length} vagas)`);
}

function scoreColor(score: number): string {
  if (score >= 3) return '#10b981';
  if (score >= 1) return '#f59e0b';
  return '#6b6b85';
}

function escHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
