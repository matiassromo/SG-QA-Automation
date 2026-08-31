import { z } from 'zod';

const nonEmptyText = z.string().trim().min(1);
const workItemId = z.number().int().positive();

export const testStepSchema = z.strictObject({
  action: nonEmptyText,
  expected: nonEmptyText,
});

export const designReferenceSchema = z.strictObject({
  provider: z.literal('figma'),
  fileKey: nonEmptyText,
  nodeId: nonEmptyText.optional(),
  url: z.string().url(),
});

export const configurationAssignmentSchema =
  z.discriminatedUnion('mode', [
    z.strictObject({
      mode: z.literal('inherit-suite'),
    }),
    z.strictObject({
      mode: z.literal('selected'),
      configurationNames: z.array(nonEmptyText).min(1),
    }),
  ]);

export const testCaseSchema = z.strictObject({
  title: nonEmptyText,
  priority: z.number().int().min(1).max(3),
  type: z.enum([
    'functional',
    'negative',
    'validation',
    'integration',
    'edge',
  ]),
  preconditions: z.array(nonEmptyText),
  steps: z.array(
    testStepSchema
  ).min(1),
  sourceWorkItemIds: z.array(workItemId).min(1),
  designReferences: z.array(designReferenceSchema),
  configurationAssignment: configurationAssignmentSchema,
  automationCandidate: z.boolean(),
});

export const testSuiteSchema = z.strictObject({
  name: nonEmptyText,
  sourceWorkItemId: workItemId,
  suiteType: z.literal('requirement'),
  objective: nonEmptyText,
  defaultConfigurationNames: z.array(nonEmptyText).min(1),
  testCases: z.array(testCaseSchema).min(1),
});

export const coverageWarningSchema = z.strictObject({
  title: nonEmptyText,
  description: nonEmptyText,
  source: z.enum(['RFC', 'Figma', 'Azure DevOps']),
});

export const generatedTestPlanSchema = z.strictObject({
  testPlanName: nonEmptyText,
  objective: nonEmptyText,
  featureId: workItemId,
  epicId: workItemId,
  iterationPath: nonEmptyText,
  suites: z.array(testSuiteSchema).min(1),
  coverageWarnings: z.array(coverageWarningSchema),
});

export type GeneratedTestPlan = z.infer<
  typeof generatedTestPlanSchema
>;
