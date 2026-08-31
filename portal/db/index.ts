import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function getDb() {
  if (!env.DB) {
    throw new Error(
      'Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database.',
    );
  }

  return drizzle(env.DB, { schema });
}

export async function ensureSchema() {
  if (!env.DB) throw new Error('Cloudflare D1 binding `DB` is unavailable.');
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS execution_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requested_by TEXT NOT NULL,
      project TEXT NOT NULL,
      plan_id INTEGER NOT NULL,
      suite_id INTEGER NOT NULL,
      configuration TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS rfc_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      name TEXT NOT NULL,
      original_file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      content_base64 TEXT NOT NULL,
      extracted_text TEXT NOT NULL,
      hu_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS test_case_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      requirement_id INTEGER NOT NULL,
      rfc_id INTEGER,
      sequence INTEGER NOT NULL,
      title TEXT NOT NULL,
      case_type TEXT NOT NULL,
      preconditions TEXT NOT NULL,
      steps TEXT NOT NULL,
      expected_result TEXT NOT NULL,
      configurations TEXT NOT NULL DEFAULT '[]',
      automatable INTEGER NOT NULL DEFAULT 1,
      automation_reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS qa_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      name TEXT NOT NULL,
      iteration TEXT NOT NULL,
      plan_id INTEGER,
      plan_name TEXT NOT NULL,
      rfc_ids TEXT NOT NULL DEFAULT '[]',
      requirement_ids TEXT NOT NULL DEFAULT '[]',
      configurations TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'planning',
      analysis TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_qa_campaigns_project ON qa_campaigns(project)').run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS automation_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      plan_id INTEGER NOT NULL,
      suite_id INTEGER NOT NULL,
      test_case_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'NOT_ANALYZED',
      automatable INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      requirements TEXT NOT NULL DEFAULT '[]',
      missing_context TEXT NOT NULL DEFAULT '[]',
      capabilities TEXT NOT NULL DEFAULT '[]',
      analyzed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project, plan_id, suite_id, test_case_id)
    )
  `).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_automation_analyses_suite ON automation_analyses(project, plan_id, suite_id)').run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS automation_project_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL UNIQUE,
      application_type TEXT NOT NULL DEFAULT 'web',
      base_url TEXT NOT NULL DEFAULT '',
      username_env TEXT NOT NULL DEFAULT '',
      password_env TEXT NOT NULL DEFAULT '',
      auth_mode TEXT NOT NULL DEFAULT 'form',
      login_path TEXT NOT NULL DEFAULT '/',
      username_locator TEXT NOT NULL DEFAULT '',
      password_locator TEXT NOT NULL DEFAULT '',
      submit_locator TEXT NOT NULL DEFAULT '',
      authenticated_locator TEXT NOT NULL DEFAULT '',
      navigation_locator TEXT NOT NULL DEFAULT '',
      configuration_mappings TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    )
  `).run();
  await env.DB.prepare('PRAGMA optimize').run();
}
