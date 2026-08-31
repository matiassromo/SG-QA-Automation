import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { GeneratedTestPlan } from '../ai/testPlanSchema';
import { loadProjectProfile } from '../config/projectProfile';

const optionalText = z.string().trim().min(1).optional();
const testCaseNamingSchema = z.strictObject({
  prefix: z.string().trim().min(1).default('QA'),
  numberSeparator: z.string().min(1).default(' - TC-'),
  padding: z.number().int().min(1).max(8).default(3),
  titleSeparator: z.string().min(1).default(' '),
});

export const publicationTargetFileSchema = z.strictObject({
  organization: optionalText,
  project: optionalText,
  areaPath: optionalText,
  iterationPath: optionalText,
  testPlanName: optionalText,
  existingPlanId: z.number().int().positive().optional(),
  parentSuiteId: z.number().int().positive().optional(),
  defaultTesterIds: z.array(z.string().trim().min(1)).optional(),
  testCaseNaming: testCaseNamingSchema.optional(),
  existingTestCasePolicy: z.enum(['block', 'append', 'reuse']).optional(),
});

export type PublicationTargetFile = z.infer<typeof publicationTargetFileSchema>;

export interface PublicationTarget {
  organization: string;
  project: string;
  areaPath?: string;
  iterationPath: string;
  testPlanName: string;
  existingPlanId?: number;
  parentSuiteId?: number;
  defaultTesterIds: string[];
  testCaseNaming: z.infer<typeof testCaseNamingSchema>;
  existingTestCasePolicy: 'block' | 'append' | 'reuse';
}

export interface PublicationTargetOverrides extends PublicationTargetFile {
  targetFile?: string;
  profileFile?: string;
}

export async function resolvePublicationTarget(
  plan: GeneratedTestPlan,
  overrides: PublicationTargetOverrides
): Promise<PublicationTarget> {
  let fileValues: PublicationTargetFile = {};
  let profileConnection: { organization: string; project: string } | undefined;

  if (overrides.profileFile) {
    const profile = await loadProjectProfile(overrides.profileFile);
    profileConnection = profile.azure;
    fileValues = {
      organization: profile.azure.organization,
      project: profile.azure.project,
      areaPath: profile.azure.areaPath,
      defaultTesterIds: profile.azure.defaultTesterIds,
      testCaseNaming: profile.azure.testCaseNaming,
      existingTestCasePolicy: profile.azure.existingTestCasePolicy,
    };
  }

  const switchesProfileConnection = profileConnection && (
    (overrides.organization && overrides.organization !== profileConnection.organization) ||
    (overrides.project && overrides.project !== profileConnection.project)
  );

  if (switchesProfileConnection) {
    if (overrides.areaPath === undefined) delete fileValues.areaPath;
    if (overrides.defaultTesterIds === undefined) delete fileValues.defaultTesterIds;
  }

  if (overrides.targetFile) {
    const filePath = path.resolve(overrides.targetFile);
    fileValues = { ...fileValues, ...publicationTargetFileSchema.parse(
      JSON.parse(await readFile(filePath, 'utf8'))
    ) };
  }

  const merged = { ...fileValues, ...withoutUndefined(overrides) };
  const organization = merged.organization ?? process.env.AZURE_DEVOPS_ORG;
  const project = merged.project ?? process.env.AZURE_DEVOPS_PROJECT;

  if (!organization || !project) {
    throw new Error(
      'El destino requiere organization y project (parámetros, archivo o .env)'
    );
  }

  if (merged.parentSuiteId && !merged.existingPlanId) {
    throw new Error('parentSuiteId solo se puede usar junto con existingPlanId');
  }

  return {
    organization,
    project,
    areaPath: merged.areaPath,
    iterationPath: merged.iterationPath ?? plan.iterationPath,
    testPlanName: merged.testPlanName ?? plan.testPlanName,
    existingPlanId: merged.existingPlanId,
    parentSuiteId: merged.parentSuiteId,
    defaultTesterIds: merged.defaultTesterIds ?? [],
    testCaseNaming: merged.testCaseNaming ?? testCaseNamingSchema.parse({}),
    existingTestCasePolicy: merged.existingTestCasePolicy ?? 'block',
  };
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as Partial<T>;
}
