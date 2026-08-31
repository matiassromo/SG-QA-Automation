import 'dotenv/config';

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { automationManifestSchema } from '../automation/automationManifestSchema';
import { azureRequest, AzureListResponse } from '../azure/restClient';
import { AzureTestOutcome, publishTestSuiteResults } from '../azure/testResultPublisher';

type JournalSuite = { id: number; name: string; requirementId: number };
type Journal = { planId: number; planName: string; suites: JournalSuite[] };
type Point = {
  id: number;
  testCase?: { id?: string; name?: string };
  testCaseReference?: { id?: number; name?: string };
  configuration?: { id?: string; name?: string };
};
type Discovered = {
  title: string;
  file: string;
  line: number;
  testCaseId: number;
  configuration?: string;
  outcome?: AzureTestOutcome;
  durationMs?: number;
  videos?: string[];
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = required(args.manifest, '--manifest');
  const apply = args.apply === 'true';
  const project = args.project ?? 'synergy-chrome';
  const selectedSuiteId = args.suite ? Number(args.suite) : undefined;
  const manifest = automationManifestSchema.parse(JSON.parse(
    await readFile(path.resolve(manifestPath), 'utf8')
  ));
  const journal = JSON.parse(await readFile(path.resolve(manifest.sourceJournal), 'utf8')) as Journal;
  const target = { organization: manifest.organization, project: manifest.project };
  const discovered = flattenReport(runPlaywright(project, ['--list']));
  const implemented = new Map(discovered.map(item => [item.testCaseId, item]));
  const publications: unknown[] = [];
  const totals = { points: 0, executed: 0, passed: 0, failed: 0, blocked: 0 };

  const suitesToRun = selectedSuiteId
    ? journal.suites.filter(suite => suite.id === selectedSuiteId)
    : journal.suites;
  if (selectedSuiteId && suitesToRun.length === 0) {
    throw new Error(`La suite ${selectedSuiteId} no pertenece al Plan ${manifest.planId}`);
  }
  console.log(`${selectedSuiteId ? 'Suite seleccionada' : 'Plan completo'}: ${manifest.planId} ${manifest.planName}`);
  console.log(`Suites: ${suitesToRun.length}`);

  for (const suite of suitesToRun) {
    const response = await azureRequest<AzureListResponse<Point>>(
      'GET', `/_apis/testplan/Plans/${manifest.planId}/Suites/${suite.id}/TestPoint`,
      { target, query: { 'api-version': '7.1' } }
    );
    const points = response.data.value;
    const groups = new Map<string, Point[]>();
    for (const point of points) {
      const configuration = point.configuration?.name?.trim() || 'Sin configuración';
      groups.set(configuration, [...(groups.get(configuration) ?? []), point]);
    }
    const suiteCases: Array<Parameters<typeof publishTestSuiteResults>[0]['cases'][number]> = [];

    for (const [configurationName, configuredPoints] of groups) {
      const uniquePoints = [...new Map(configuredPoints.map(point => [pointTestCaseId(point), point])).values()]
        .filter(point => Number.isInteger(pointTestCaseId(point)));
      totals.points += uniquePoints.length;
      const executable = uniquePoints.filter(point => {
        const id = pointTestCaseId(point);
        const definition = manifest.cases.find(item => item.azureTestCaseId === id);
        const executionTarget = definition?.executionTargets.find(item =>
          item.configurationName.toLocaleLowerCase() === configurationName.toLocaleLowerCase()
        );
        return !!definition && !!implemented.get(id) && executionTarget?.supportedNow && executionTarget.runner === 'playwright-web';
      });
      let executions = new Map<number, Discovered>();
      if (apply && executable.length) {
        const locations = executable.map(point => {
          const test = implemented.get(pointTestCaseId(point))!;
          return `tests/${test.file}:${test.line}`;
        });
        executions = new Map(flattenReport(runPlaywright(project, locations), true)
          .map(item => [item.testCaseId, item]));
      }

      const cases = uniquePoints.map(point => {
        const id = pointTestCaseId(point);
        const definition = manifest.cases.find(item => item.azureTestCaseId === id);
        const executionTarget = definition?.executionTargets.find(item =>
          item.configurationName.toLocaleLowerCase() === configurationName.toLocaleLowerCase()
        );
        const execution = executions.get(id);
        let outcome: AzureTestOutcome = 'Blocked';
        let reason = '';
        if (execution) {
          outcome = execution.outcome ?? 'Failed';
          reason = outcome === 'Passed'
            ? 'Caso ejecutado automáticamente con Playwright.'
            : 'La validación automatizada falló; revisar el video y los pasos del resultado.';
          totals.executed += 1;
          outcome === 'Passed' ? totals.passed += 1 : totals.failed += 1;
        } else {
          totals.blocked += 1;
          if (!definition) reason = 'No automatizable todavía: el caso reutilizado no posee una definición de automatización en el manifiesto vigente.';
          else if (!executionTarget) reason = `No automatizable todavía: la configuración ${configurationName} no está definida para este caso.`;
          else if (!executionTarget.supportedNow) reason = `No automatizable con el runner actual: ${executionTarget.note}`;
          else if (!implemented.has(id)) reason = 'Automatizable con Playwright, pero bloqueado: todavía no existe el script implementado para este caso.';
          else reason = 'Bloqueado: Playwright no devolvió un resultado ejecutable para este caso.';
        }
        return {
          testCaseId: id,
          configurationName,
          outcome,
          automatedTestName: `QA-TC-${id}`,
          priority: definition?.priority ?? 2,
          steps: (definition?.steps ?? []).map(step => ({ ...step, outcome })),
          durationMs: execution?.durationMs ?? 0,
          attachmentPaths: execution?.videos ?? [],
          comment: reason,
        };
      });

      console.log(`Suite ${suite.id} | ${configurationName}: ${cases.length} casos (${cases.filter(x => x.outcome === 'Blocked').length} bloqueados)`);
      suiteCases.push(...cases);
    }
    const publication = await publishTestSuiteResults({
      target,
      planId: manifest.planId,
      suiteId: suite.id,
      suiteName: suite.name,
      configurationName: 'Todas las configuraciones',
      azureRunMode: 'planned',
      cases: suiteCases,
      apply,
    });
    publications.push({ suiteId: suite.id, ...publication });
    if (publication.runId) console.log(`Azure Test Run: ${publication.runId}`);
    if (publication.webAccessUrl) console.log(`URL: ${publication.webAccessUrl}`);
  }

  const directory = path.resolve('generated', 'executions');
  await mkdir(directory, { recursive: true });
  const journalPath = path.join(directory, `plan-${manifest.planId}-full-${Date.now()}.json`);
  await writeFile(journalPath, JSON.stringify({
    executedAt: new Date().toISOString(), apply, planId: manifest.planId, totals, publications,
  }, null, 2) + '\n', 'utf8');
  console.log(`Total Test Points: ${totals.points}`);
  console.log(`Ejecutados: ${totals.executed} | Passed: ${totals.passed} | Failed: ${totals.failed} | Blocked: ${totals.blocked}`);
  console.log(`Journal: ${journalPath}`);
  if (!apply) console.log('Dry-run válido; no se ejecutó Playwright ni se escribió en Azure.');
}

function runPlaywright(project: string, extra: string[]) {
  const cli = path.resolve('node_modules', '@playwright', 'test', 'cli.js');
  const result = spawnSync(process.execPath, [cli, 'test', `--project=${project}`, '--reporter=json', ...extra], {
    cwd: process.cwd(), env: { ...process.env, DOTENV_CONFIG_QUIET: 'true' }, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const marker = output.indexOf('{\n  "config"');
  if (marker < 0) throw new Error(`Playwright no produjo JSON válido:\n${output.slice(-2000)}`);
  return JSON.parse(output.slice(marker, output.lastIndexOf('}') + 1));
}

function flattenReport(report: any, executed = false): Discovered[] {
  return flattenSpecs(report.suites ?? []).flatMap((spec: any) => (spec.tests ?? []).map((test: any) => {
    const annotations = test.annotations ?? [];
    const last = (test.results ?? []).at(-1) ?? {};
    return {
      title: spec.title, file: spec.file, line: spec.line,
      testCaseId: Number(annotation(annotations, 'azure-test-case-id')),
      configuration: annotation(annotations, 'configuration'),
      ...(executed ? {
        outcome: mapOutcome(last.status), durationMs: Number(last.duration ?? 0),
        videos: (last.attachments ?? []).filter((x: any) => x.contentType === 'video/webm' && x.path).map((x: any) => x.path),
      } : {}),
    };
  })).filter((item: Discovered) => Number.isInteger(item.testCaseId));
}
function flattenSpecs(suites: any[]): any[] { return suites.flatMap(suite => [...(suite.specs ?? []), ...flattenSpecs(suite.suites ?? [])]); }
function annotation(items: any[], type: string) { return items.find(item => item.type === type)?.description; }
function mapOutcome(status: string): AzureTestOutcome { return status === 'passed' ? 'Passed' : status === 'skipped' ? 'Blocked' : 'Failed'; }
function parseArgs(args: string[]) {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--apply') { values.apply = 'true'; continue; }
    const key = args[i] === '--manifest' ? 'manifest' : args[i] === '--project' ? 'project' : args[i] === '--suite' ? 'suite' : '';
    if (!key || !args[i + 1]) throw new Error(`Argumento inválido: ${args[i]}`);
    values[key] = args[++i];
  }
  return values;
}
function required(value: string | undefined, flag: string) { if (!value) throw new Error(`Falta ${flag}`); return value; }
function pointTestCaseId(point: Point) { return Number(point.testCaseReference?.id ?? point.testCase?.id); }

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
