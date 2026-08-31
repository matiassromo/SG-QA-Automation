import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

const envName = z.string().regex(/^[A-Z][A-Z0-9_]*$/);

export const projectProfileSchema = z.strictObject({
  profileName: z.string().trim().min(1),
  azure: z.strictObject({
    organization: z.string().trim().min(1),
    project: z.string().trim().min(1),
    areaPath: z.string().trim().min(1).optional(),
    defaultTesterIds: z.array(z.string().trim().min(1)).default([]),
    testCaseNaming: z.strictObject({
      prefix: z.string().trim().min(1).default('QA'),
      numberSeparator: z.string().min(1).default(' - TC-'),
      padding: z.number().int().min(1).max(8).default(3),
      titleSeparator: z.string().min(1).default(' '),
    }).optional(),
    existingTestCasePolicy: z.enum(['block', 'append', 'reuse']).default('block'),
  }),
  applications: z.record(z.string(), z.strictObject({
    baseUrlEnv: envName,
    usernameEnv: envName.optional(),
    passwordEnv: envName.optional(),
  })).default({}),
  sourcePolicy: z.strictObject({
    featureIdIsRuntimeInput: z.literal(true),
    discoverChildRequirements: z.literal(true),
    rfcLocation: z.literal('epic-attachment'),
    rfcExtension: z.literal('.docx'),
  }),
});

export type ProjectProfile = z.infer<typeof projectProfileSchema>;

export async function loadProjectProfile(filePath: string) {
  return projectProfileSchema.parse(JSON.parse(
    await readFile(path.resolve(filePath), 'utf8')
  ));
}

export function validateProfileEnvironment(profile: ProjectProfile) {
  const missing = new Set<string>();
  for (const application of Object.values(profile.applications)) {
    for (const name of [
      application.baseUrlEnv,
      application.usernameEnv,
      application.passwordEnv,
    ]) {
      if (name && !process.env[name]) missing.add(name);
    }
  }
  return [...missing];
}
