/**
 * Gupy Easy Apply
 *
 * Gupy's "Candidatura Simplificada" (Easy Apply) works via their REST API
 * without requiring a logged-in session. It accepts multipart form data
 * with the candidate's basic info + optional resume PDF.
 *
 * Flow:
 * 1. GET job details to confirm Easy Apply is available
 * 2. POST /api/2.1/jobs/{jobId}/apply with candidate data
 * 3. If resume upload is needed, POST to the presigned S3 URL returned
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';

export interface GupyApplyConfig {
  jobId: string;
  companySlug: string;
  profile: {
    name: string;
    email: string;
    phone: string;
    linkedin?: string;
    resume_path?: string;
  };
}

export interface GupyApplyResult {
  success: boolean;
  method: 'easy_apply' | 'redirect' | 'error';
  message: string;
  apply_url?: string;
  application_id?: string;
}

const GUPY_BASE = 'https://api.gupy.io';

export async function gupyEasyApply(config: GupyApplyConfig): Promise<GupyApplyResult> {
  try {
    // Step 1: Check if job supports Easy Apply
    const jobResp = await axios.get(
      `${GUPY_BASE}/api/2.1/jobs/${config.jobId}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)',
          'Accept': 'application/json',
          'Origin': `https://${config.companySlug}.gupy.io`,
          'Referer': `https://${config.companySlug}.gupy.io/jobs/${config.jobId}`,
        },
        timeout: 10000,
      }
    ).catch(() => null);

    const jobData = jobResp?.data;
    const isEasyApply = jobData?.isQuickApply || jobData?.quickApply || jobData?.applicationFlow === 'quick';
    const applyUrl = `https://${config.companySlug}.gupy.io/jobs/${config.jobId}`;

    if (!isEasyApply) {
      // Not Easy Apply — return the URL for manual application
      return {
        success: true,
        method: 'redirect',
        message: 'Vaga não tem Candidatura Simplificada. Abrindo formulário completo.',
        apply_url: applyUrl,
      };
    }

    // Step 2: Build FormData payload
    const form = new FormData();
    form.append('name', config.profile.name);
    form.append('email', config.profile.email);
    form.append('phone', config.profile.phone.replace(/\D/g, ''));
    if (config.profile.linkedin) form.append('linkedin', config.profile.linkedin);

    // Attach resume if provided and file exists
    if (config.profile.resume_path && fs.existsSync(config.profile.resume_path)) {
      const resumeBuffer = fs.readFileSync(config.profile.resume_path);
      const filename = path.basename(config.profile.resume_path);
      form.append('resume', resumeBuffer, { filename, contentType: 'application/pdf' });
    }

    // Step 3: Submit Easy Apply
    const applyResp = await axios.post(
      `${GUPY_BASE}/api/2.1/jobs/${config.jobId}/apply`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)',
          'Origin': `https://${config.companySlug}.gupy.io`,
          'Referer': `https://${config.companySlug}.gupy.io/jobs/${config.jobId}`,
        },
        timeout: 20000,
      }
    );

    const appId = applyResp.data?.id || applyResp.data?.applicationId;

    return {
      success: true,
      method: 'easy_apply',
      message: `Candidatura enviada com sucesso via Gupy Easy Apply!`,
      apply_url: applyUrl,
      application_id: appId ? String(appId) : undefined,
    };

  } catch (err: any) {
    const status = err.response?.status;

    // 409 = already applied
    if (status === 409) {
      return {
        success: true,
        method: 'easy_apply',
        message: 'Você já se candidatou a esta vaga anteriormente.',
      };
    }

    // 422 = validation error (missing fields etc)
    if (status === 422) {
      return {
        success: false,
        method: 'error',
        message: `Dados inválidos: ${JSON.stringify(err.response?.data?.errors || err.response?.data)}`,
        apply_url: `https://${config.companySlug}.gupy.io/jobs/${config.jobId}`,
      };
    }

    return {
      success: false,
      method: 'error',
      message: `Erro ao candidatar: ${err.message}`,
      apply_url: `https://${config.companySlug}.gupy.io/jobs/${config.jobId}`,
    };
  }
}

/**
 * Extract Gupy job ID and company slug from a Gupy URL
 * Handles formats:
 *   https://companyslug.gupy.io/jobs/12345
 *   https://portal.gupy.io/job-opportunities/12345
 */
export function parseGupyUrl(url: string): { jobId: string; companySlug: string } | null {
  try {
    const u = new URL(url);

    // Company portal: {slug}.gupy.io/jobs/{id}
    const portalMatch = u.hostname.match(/^(.+)\.gupy\.io$/);
    if (portalMatch && portalMatch[1] !== 'portal') {
      const jobMatch = u.pathname.match(/\/jobs\/(\d+)/);
      if (jobMatch) {
        return { jobId: jobMatch[1]!, companySlug: portalMatch[1]! };
      }
    }

    // Main portal: portal.gupy.io/job-opportunities/{id}?jobName=...&careerPageSlug={slug}
    if (u.hostname === 'portal.gupy.io') {
      const jobMatch = u.pathname.match(/\/job-opportunities\/(\d+)/);
      const slug = u.searchParams.get('careerPageSlug') || 'portal';
      if (jobMatch) {
        return { jobId: jobMatch[1]!, companySlug: slug };
      }
    }
  } catch { /* invalid URL */ }

  return null;
}
