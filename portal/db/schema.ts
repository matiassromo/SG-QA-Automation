import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const executionRequests = sqliteTable('execution_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  requestedBy: text('requested_by').notNull(),
  project: text('project').notNull(),
  planId: integer('plan_id').notNull(),
  suiteId: integer('suite_id').notNull(),
  configuration: text('configuration').notNull(),
  status: text('status').notNull().default('queued'),
  createdAt: text('created_at').notNull(),
});

export const rfcDocuments = sqliteTable('rfc_documents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  project: text('project').notNull(),
  name: text('name').notNull(),
  originalFileName: text('original_file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  version: text('version').notNull(),
  status: text('status').notNull().default('ready'),
  contentBase64: text('content_base64').notNull(),
  extractedText: text('extracted_text').notNull(),
  huIds: text('hu_ids').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
});

export const testCaseDrafts = sqliteTable('test_case_drafts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  project: text('project').notNull(),
  requirementId: integer('requirement_id').notNull(),
  rfcId: integer('rfc_id'),
  sequence: integer('sequence').notNull(),
  title: text('title').notNull(),
  caseType: text('case_type').notNull(),
  preconditions: text('preconditions').notNull(),
  steps: text('steps').notNull(),
  expectedResult: text('expected_result').notNull(),
  configurations: text('configurations').notNull().default('[]'),
  automatable: integer('automatable', { mode: 'boolean' }).notNull().default(true),
  automationReason: text('automation_reason').notNull().default(''),
  status: text('status').notNull().default('draft'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const qaCampaigns = sqliteTable('qa_campaigns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  project: text('project').notNull(),
  name: text('name').notNull(),
  iteration: text('iteration').notNull(),
  planId: integer('plan_id'),
  planName: text('plan_name').notNull(),
  rfcIds: text('rfc_ids').notNull().default('[]'),
  requirementIds: text('requirement_ids').notNull().default('[]'),
  configurations: text('configurations').notNull().default('[]'),
  status: text('status').notNull().default('planning'),
  analysis: text('analysis').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const automationAnalyses = sqliteTable('automation_analyses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  project: text('project').notNull(),
  planId: integer('plan_id').notNull(),
  suiteId: integer('suite_id').notNull(),
  testCaseId: integer('test_case_id').notNull(),
  status: text('status').notNull().default('NOT_ANALYZED'),
  automatable: integer('automatable', { mode: 'boolean' }).notNull().default(false),
  confidence: real('confidence').notNull().default(0),
  reason: text('reason').notNull().default(''),
  requirements: text('requirements').notNull().default('[]'),
  missingContext: text('missing_context').notNull().default('[]'),
  capabilities: text('capabilities').notNull().default('[]'),
  analyzedAt: text('analyzed_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => ({
  context: uniqueIndex('automation_analyses_context').on(table.project, table.planId, table.suiteId, table.testCaseId),
}));

export const automationProjectSettings = sqliteTable('automation_project_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  project: text('project').notNull().unique(),
  applicationType: text('application_type').notNull().default('web'),
  baseUrl: text('base_url').notNull().default(''),
  usernameEnv: text('username_env').notNull().default(''),
  passwordEnv: text('password_env').notNull().default(''),
  authMode: text('auth_mode').notNull().default('form'),
  loginPath: text('login_path').notNull().default('/'),
  usernameLocator: text('username_locator').notNull().default(''),
  passwordLocator: text('password_locator').notNull().default(''),
  submitLocator: text('submit_locator').notNull().default(''),
  authenticatedLocator: text('authenticated_locator').notNull().default(''),
  navigationLocator: text('navigation_locator').notNull().default(''),
  configurationMappings: text('configuration_mappings').notNull().default('{}'),
  updatedAt: text('updated_at').notNull(),
});
