import 'dotenv/config';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import {
  AzureTestOutcome,
  publishTestResult,
} from '../azure/testResultPublisher';
import { automationManifestSchema } from '../automation/automationManifestSchema';

const argsSchema = z.strictObject({
  organization: z.string().min(1),
  project: z.string().min(1),
  planId: z.number().int().positive(),
  suiteId: z.number().int().positive(),
  testCaseId: z.number().int().positive(),
  configurationName: z.string().min(1),
  outcome: z.enum(['Passed', 'Failed', 'Blocked', 'NotApplicable']),
  automatedTestName: z.string().min(1),
  durationMs: z.number().int().nonnegative().optional(),
  attachmentPath: z.string().min(1).optional(),
  manifestPath: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
  azureRunMode: z.enum(['planned', 'automated']).default('planned'),
  apply: z.boolean(),
});

async function main() {
  const values = parseArgs(process.argv.slice(2));
  const input = argsSchema.parse({
    organization: values.organization ?? process.env.AZURE_DEVOPS_ORG,
    project: values.project ?? process.env.AZURE_DEVOPS_PROJECT,
    planId: number(values.plan, '--plan'),
    suiteId: number(values.suite, '--suite'),
    testCaseId: number(values.case, '--case'),
    configurationName: values.configuration,
    outcome: values.outcome ?? 'Passed',
    automatedTestName: values.testName,
    durationMs: values.duration ? number(values.duration, '--duration') : undefined,
    attachmentPath: values.attachment,
    manifestPath: values.manifest,
    ownerId: values.ownerId ?? process.env.AZURE_DEVOPS_RUN_BY_ID,
    azureRunMode: values.azureRunMode ?? 'planned',
    apply: values.apply === 'true',
  });

  if (input.apply && !input.attachmentPath) {
    throw new Error(
      'Toda publicación aplicada requiere --attachment con el video de evidencia.'
    );
  }
  if (input.apply && !input.manifestPath) {
    throw new Error(
      'Toda publicación aplicada requiere --manifest para publicar prioridad y pasos.'
    );
  }

  const manifest = input.manifestPath
    ? automationManifestSchema.parse(JSON.parse(
        await readFile(path.resolve(input.manifestPath), 'utf8')
      ))
    : undefined;
  const manifestCase = manifest?.cases.find(
    item => item.azureTestCaseId === input.testCaseId
  );
  if (input.manifestPath && !manifestCase) {
    throw new Error(
      `El manifiesto no contiene el Test Case ${input.testCaseId}`
    );
  }

  const result = await publishTestResult({
    target: { organization: input.organization, project: input.project },
    planId: input.planId,
    suiteId: input.suiteId,
    testCaseId: input.testCaseId,
    configurationName: input.configurationName,
    outcome: input.outcome as AzureTestOutcome,
    automatedTestName: input.automatedTestName,
    priority: manifestCase?.priority,
    steps: manifestCase?.steps.map(step => ({
      action: step.action,
      expected: step.expected,
      outcome: input.outcome as AzureTestOutcome,
    })),
    ownerId: input.ownerId,
    azureRunMode: input.azureRunMode,
    durationMs: input.durationMs,
    attachmentPaths: input.attachmentPath ? [input.attachmentPath] : [],
    apply: input.apply,
  });

  console.log(input.apply ? 'Resultado publicado.' : 'Dry-run válido; no se escribió en Azure.');
  console.log(`Test Point: ${result.testPointId}`);
  console.log(`Configuración: ${input.configurationName} (${result.configurationId ?? 'sin ID'})`);
  console.log(`Outcome: ${result.outcome}`);

  if (result.applied) {
    const directory = path.resolve('generated', 'test-results');
    await mkdir(directory, { recursive: true });
    const journalPath = path.join(
      directory,
      `plan-${input.planId}-case-${input.testCaseId}-run-${result.runId}.json`
    );
    await writeFile(journalPath, JSON.stringify({
      publishedAt: new Date().toISOString(),
      organization: input.organization,
      project: input.project,
      planId: input.planId,
      suiteId: input.suiteId,
      testCaseId: input.testCaseId,
      configurationName: input.configurationName,
      ...result,
    }, null, 2) + '\n', 'utf8');
    console.log(`Azure Test Run: ${result.runId}`);
    console.log(`Azure Test Result: ${result.testResultId}`);
    console.log(`Adjuntos: ${result.attachmentIds?.length ?? 0}`);
    console.log(`Journal: ${journalPath}`);
  }
}

function parseArgs(args: string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (item === '--apply') {
      values.apply = 'true';
      continue;
    }
    if (!item.startsWith('--')) throw new Error(`Argumento inválido: ${item}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Falta valor para ${item}`);
    values[toKey(item)] = value;
    index += 1;
  }
  return values;
}

function toKey(flag: string) {
  const mapping: Record<string, string> = {
    '--organization': 'organization',
    '--project': 'project',
    '--plan': 'plan',
    '--suite': 'suite',
    '--case': 'case',
    '--configuration': 'configuration',
    '--outcome': 'outcome',
    '--test-name': 'testName',
    '--duration': 'duration',
    '--attachment': 'attachment',
    '--manifest': 'manifest',
    '--owner-id': 'ownerId',
    '--azure-run-mode': 'azureRunMode',
  };
  const key = mapping[flag];
  if (!key) throw new Error(`Opción desconocida: ${flag}`);
  return key;
}

function number(value: string | undefined, flag: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} debe ser entero positivo`);
  return parsed;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
