export interface Job {
  id: string;
  title: string;
  company: string;
  location?: string;
  remote?: 'remote' | 'hybrid' | 'onsite';
  salary?: string;
  description?: string;
  requirements?: string[];
  url: string;
  apply_url?: string;
  source: 'gupy' | 'inhire' | 'glassdoor' | 'catho' | 'infojobs' | 'custom';
  posted_at?: string;
  fetched_at: string;
  tags?: string[];
  status?: 'new' | 'saved' | 'ignored';
}

export interface Application {
  id: string;
  job_id: string;
  status: 'pending' | 'applied' | 'interview' | 'offer' | 'rejected' | 'ghosted';
  applied_at?: string;
  notes?: string;
  cover_letter?: string;
  response_at?: string;
  response_type?: string;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  name?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  resume_path?: string;
  summary?: string;
  skills?: string[];
  experience?: string;
  education?: string;
  target_roles?: string[];
  target_locations?: string[];
  min_salary?: number;
  blacklist_companies?: string[];
  keywords?: string[];
}

export interface SearchConfig {
  keywords: string[];
  location?: string;
  remote_only?: boolean;
  sources?: string[];
}

export interface ScraperResult {
  jobs: Job[];
  errors: string[];
  source: string;
  duration_ms: number;
}
