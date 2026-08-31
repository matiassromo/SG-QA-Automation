import { z } from 'zod';

const executionTargetSchema = z.strictObject({
  configurationName: z.string().min(1),
  runner: z.enum([
    'playwright-web',
    'mobile-runner-required',
    'browser-definition-required',
  ]),
  supportedNow: z.boolean(),
  note: z.string().min(1),
});

const manifestCaseSchema = z.strictObject({
  azureTestCaseId: z.number().int().positive(),
  requirementId: z.number().int().positive(),
  suiteName: z.string().min(1),
  title: z.string().min(1),
  priority: z.number().int().min(1).max(3),
  type: z.string().min(1),
  preconditions: z.array(z.string()),
  steps: z.array(z.strictObject({
    action: z.string().min(1),
    expected: z.string().min(1),
  })).min(1),
  executionTargets: z.array(executionTargetSchema).min(1),
  playwrightEligible: z.boolean(),
  selectorDiscoveryRequired: z.literal(true),
  status: z.enum([
    'ready-for-scaffold',
    'runner-definition-required',
  ]),
});

export const automationManifestSchema = z.strictObject({
  generatedAt: z.string().datetime(),
  featureId: z.number().int().positive(),
  planId: z.number().int().positive(),
  planName: z.string().min(1),
  organization: z.string().min(1),
  project: z.string().min(1),
  sourcePreview: z.string().min(1),
  sourceJournal: z.string().min(1),
  summary: z.strictObject({
    totalTestCases: z.number().int().nonnegative(),
    automationCandidates: z.number().int().nonnegative(),
    playwrightEligible: z.number().int().nonnegative(),
    runnerDefinitionRequired: z.number().int().nonnegative(),
  }),
  cases: z.array(manifestCaseSchema),
});

export type AutomationManifest = z.infer<typeof automationManifestSchema>;
