import 'dotenv/config';

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { automationManifestSchema } from '../automation/automationManifestSchema';
import {
  AzureTestOutcome,
  publishTestSuiteResults,
} from '../azure/testResultPublisher';

interface JournalSuite {
  id: number;
  name: string;
  requirementId: number;
}

interface PublicationJournal {
  planId: number;
  planName: string;
  suites: JournalSuite[];
}

interface DiscoveredTest {
  title: string;
  file: string;
  line: number;
  testCaseId: number;
  requirementId?: number;
  configuration?: string;
}

interface ExecutedTest extends DiscoveredTest {
  outcome: AzureTestOutcome;
  durationMs: number;
  videos: string[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = required(args.manifest, '--manifest');
  const suiteId = positiveInteger(args.suite, '--suite');
  const configurationName = required(args.configuration, '--configuration');
  const playwrightProject = args.project ?? 'synergy-chrome';
  const apply = args.apply === 'true';

  const manifest = automationManifestSchema.parse(JSON.parse(
    await readFile(path.resolve(manifestPath), 'utf8')
  ));
  const journal = JSON.parse(
    await readFile(path.resolve(manifest.sourceJournal), 'utf8')
  ) as PublicationJournal;
  const suite = journal.suites.find(item => item.id === suiteId);
  if (!suite) throw new Error(`El journal no contiene la suite ${suiteId}`);

  const eligibleCases = manifest.cases.filter(testCase =>
    testCase.requirementId === suite.requirementId &&
    testCase.executionTargets.some(target =>
      target.configurationName.toLocaleLowerCase() ===
        configurationName.toLocaleLowerCase() &&
      target.runner === 'playwright-web' &&
      target.supportedNow
    )
  );
  if (eligibleCases.length === 0) {
    throw new Error(`La suite ${suiteId} no tiene casos Playwright para ${configurationName}`);
  }

  const discovery = runPlaywright(playwrightProject, ['--list']);
  const discovered = flattenReport(discovery).filter(test =>
    test.configuration?.toLocaleLowerCase() === configurationName.toLocaleLowerCase()
  );
  const implementedIds = new Set(discovered.map(test => test.testCaseId));
  const implementedCases = eligibleCases.filter(testCase =>
    implementedIds.has(testCase.azureTestCaseId)
  );
  const pendingCases = eligibleCases.filter(testCase =>
    !implementedIds.has(testCase.azureTestCaseId)
  );

  console.log(`Plan: ${manifest.planId} ${manifest.planName}`);
  console.log(`Suite: ${suite.id} ${suite.name}`);
  console.log(`Configuración: ${configurationName}`);
  console.log(`Elegibles: ${eligibleCases.length}`);
  console.log(`Implementados: ${implementedCases.length}`);
  console.log(`Pendientes: ${pendingCases.length}`);
  for (const pending of pendingCases) {
    console.log(`  PENDIENTE TC ${pending.azureTestCaseId}: ${pending.title}`);
  }
  if (implementedCases.length === 0) {
    throw new Error('No existen pruebas implementadas para ejecutar en esta suite');
  }

  if (!apply) {
    const dryRun = await publishTestSuiteResults({
      target: { organization: manifest.organization, project: manifest.project },
      planId: manifest.planId,
      suiteId,
      suiteName: suite.name,
      configurationName,
      cases: implementedCases.map(testCase => ({
        testCaseId: testCase.azureTestCaseId,
        outcome: 'Passed',
        automatedTestName: `TC-${testCase.azureTestCaseId}`,
        priority: testCase.priority,
        steps: testCase.steps,
        durationMs: 0,
        attachmentPaths: [],
      })),
      apply: false,
    });
    for (const result of dryRun.results) {
      console.log(`  LISTO TC ${result.testCaseId} -> Test Point ${result.testPointId}`);
    }
    console.log('Dry-run válido; no se ejecutó Playwright ni se escribió en Azure.');
    return;
  }

  const selectedLocations = discovered
    .filter(test => implementedCases.some(item => item.azureTestCaseId === test.testCaseId))
    .map(test => `tests/${test.file}:${test.line}`);
  const executionReport = runPlaywright(playwrightProject, selectedLocations);
  const executed = flattenExecutedReport(executionReport).filter(test =>
    implementedCases.some(item => item.azureTestCaseId === test.testCaseId)
  );

  const executedById = new Map(executed.map(test => [test.testCaseId, test]));
  for (const testCase of implementedCases) {
    const execution = executedById.get(testCase.azureTestCaseId);
    if (!execution) throw new Error(`Playwright no devolvió TC ${testCase.azureTestCaseId}`);
    if (execution.videos.length === 0) {
      throw new Error(`TC ${testCase.azureTestCaseId} no generó video; no se publicará la suite`);
    }
  }

  const publication = await publishTestSuiteResults({
    target: { organization: manifest.organization, project: manifest.project },
    planId: manifest.planId,
    suiteId,
    suiteName: suite.name,
    configurationName,
    azureRunMode: 'planned',
    cases: implementedCases.map(testCase => {
      const execution = executedById.get(testCase.azureTestCaseId)!;
      return {
        testCaseId: testCase.azureTestCaseId,
        outcome: execution.outcome,
        automatedTestName: testCaseTitlePrefix(execution.title),
        priority: testCase.priority,
        steps: testCase.steps.map(step => ({ ...step, outcome: execution.outcome })),
        durationMs: execution.durationMs,
        attachmentPaths: execution.videos,
      };
    }),
    apply: true,
  });

  const directory = path.resolve('generated', 'executions');
  await mkdir(directory, { recursive: true });
  const journalPath = path.join(
    directory,
    `plan-${manifest.planId}-suite-${suiteId}-run-${publication.runId}.json`
  );
  await writeFile(journalPath, JSON.stringify({
    executedAt: new Date().toISOString(),
    planId: manifest.planId,
    suiteId,
    configurationName,
    pendingTestCaseIds: pendingCases.map(item => item.azureTestCaseId),
    ...publication,
  }, null, 2) + '\n', 'utf8');

  console.log(`Azure Test Run: ${publication.runId}`);
  console.log(`Resultados publicados: ${publication.results.length}`);
  console.log(`Journal: ${journalPath}`);
  if (publication.webAccessUrl) console.log(`URL: ${publication.webAccessUrl}`);
}

function runPlaywright(project: string, extraArgs: string[]) {
  const cli = path.resolve('node_modules', '@playwright', 'test', 'cli.js');
  const result = spawnSync(process.execPath, [
    cli,
    'test',
    `--project=${project}`,
    '--reporter=json',
    ...extraArgs,
  ], {
    cwd: process.cwd(),
    env: { ...process.env, DOTENV_CONFIG_QUIET: 'true' },
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const marker = output.indexOf('{\n  "config"');
  if (marker < 0) throw new Error(`Playwright no produjo JSON válido:\n${output.slice(-2000)}`);
  const jsonText = output.slice(marker, output.lastIndexOf('}') + 1);
  const report = JSON.parse(jsonText);
  if (result.error) throw result.error;
  return report;
}

function flattenReport(report: any): DiscoveredTest[] {
  return flattenSpecs(report.suites ?? []).flatMap((spec: any) =>
    (spec.tests ?? []).map((test: any) => {
      const annotations = test.annotations ?? [];
      return {
        title: spec.title,
        file: spec.file,
        line: spec.line,
        testCaseId: Number(annotation(annotations, 'azure-test-case-id')),
        requirementId: Number(annotation(annotations, 'requirement-id')) || undefined,
        configuration: annotation(annotations, 'configuration'),
      };
    })
  ).filter((test: DiscoveredTest) => Number.isInteger(test.testCaseId));
}

function flattenExecutedReport(report: any): ExecutedTest[] {
  return flattenSpecs(report.suites ?? []).flatMap((spec: any) =>
    (spec.tests ?? []).map((test: any) => {
      const annotations = test.annotations ?? [];
      const attempts = test.results ?? [];
      const last = attempts.at(-1) ?? {};
      return {
        title: spec.title,
        file: spec.file,
        line: spec.line,
        testCaseId: Number(annotation(annotations, 'azure-test-case-id')),
        requirementId: Number(annotation(annotations, 'requirement-id')) || undefined,
        configuration: annotation(annotations, 'configuration'),
        outcome: mapOutcome(last.status),
        durationMs: Number(last.duration ?? 0),
        videos: (last.attachments ?? [])
          .filter((item: any) => item.contentType === 'video/webm' && item.path)
          .map((item: any) => item.path),
      };
    })
  ).filter((test: ExecutedTest) => Number.isInteger(test.testCaseId));
}

function flattenSpecs(suites: any[]): any[] {
  return suites.flatMap(suite => [
    ...(suite.specs ?? []),
    ...flattenSpecs(suite.suites ?? []),
  ]);
}

function annotation(items: any[], type: string) {
  return items.find(item => item.type === type)?.description;
}

function mapOutcome(status: string): AzureTestOutcome {
  if (status === 'passed') return 'Passed';
  if (status === 'skipped') return 'Blocked';
  return 'Failed';
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
    const key = ({
      '--manifest': 'manifest',
      '--suite': 'suite',
      '--configuration': 'configuration',
      '--project': 'project',
    } as Record<string, string>)[item];
    if (!key) throw new Error(`Opción desconocida: ${item}`);
    values[key] = value;
    index += 1;
  }
  return values;
}

function required(value: string | undefined, flag: string) {
  if (!value) throw new Error(`Falta ${flag}`);
  return value;
}

function positiveInteger(value: string | undefined, flag: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} debe ser entero positivo`);
  return parsed;
}

function testCaseTitlePrefix(title: string) {
  return title.match(/QA\s*-\s*TC-\d+/i)?.[0].replace(/\s+/g, '-') ?? title;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
