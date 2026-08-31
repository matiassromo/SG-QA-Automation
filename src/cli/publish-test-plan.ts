import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';

import { generatedTestPlanSchema } from '../ai/testPlanSchema';
import { createPublicationDryRun } from '../qa/publicationDryRun';
import {
  PublicationTargetOverrides,
  resolvePublicationTarget,
} from '../qa/publicationTarget';
import { publishTestPlan } from '../azure/testPlanPublisher';
import { savePublicationJournal } from '../qa/publicationJournal';

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Falta el valor de ${name}`);
  }
  return value;
}

function getArguments(args: string[]) {
  const optionsWithValues = new Set([
    '--target', '--profile', '--organization', '--project', '--area', '--iteration',
    '--plan-name', '--plan-id', '--parent-suite-id',
    '--tester-id',
  ]);
  const consumed = new Set<number>();
  args.forEach((argument, index) => {
    if (optionsWithValues.has(argument)) {
      consumed.add(index);
      consumed.add(index + 1);
    }
  });
  const positional = args.filter(
    (argument, index) =>
      !argument.startsWith('--') &&
      argument !== 'apply' &&
      !consumed.has(index)
  );
  const filePath = positional[0];
  const dryRun = args.includes('--dry-run');
  const publish = args.includes('apply') || args.includes('--apply-mode');

  if (!filePath || dryRun === publish) {
    throw new Error(
      'Uso: npm run qa:publish -- <PREVIEW_JSON> (--dry-run | apply) [opciones de destino]'
    );
  }

  return {
    filePath: path.resolve(filePath),
    publish,
    targetOverrides: {
      targetFile: readOption(args, '--target') ?? positional[1],
      profileFile: readOption(args, '--profile'),
      organization: readOption(args, '--organization'),
      project: readOption(args, '--project'),
      areaPath: readOption(args, '--area'),
      iterationPath: readOption(args, '--iteration'),
      testPlanName: readOption(args, '--plan-name'),
      existingPlanId: parsePositiveInteger(args, '--plan-id'),
      parentSuiteId: parsePositiveInteger(args, '--parent-suite-id'),
      defaultTesterIds: readRepeatedOption(args, '--tester-id'),
    } satisfies PublicationTargetOverrides,
  };
}

function readRepeatedOption(args: string[], name: string) {
  const values = args.flatMap((argument, index) =>
    argument === name && args[index + 1] ? [args[index + 1]] : []
  );
  return values.length > 0 ? values : undefined;
}

function parsePositiveInteger(args: string[], name: string) {
  const raw = readOption(args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} debe ser un entero positivo`);
  }
  return value;
}

async function main() {
  const { filePath, publish, targetOverrides } = getArguments(process.argv.slice(2));
  const raw = await readFile(filePath, 'utf8');
  const plan = generatedTestPlanSchema.parse(JSON.parse(raw));

  console.log('\n🔎 Validando publicación en modo dry-run...\n');

  const target = await resolvePublicationTarget(plan, targetOverrides);
  const dryRun = await createPublicationDryRun(plan, target);

  console.log('================================');
  console.log('       PUBLICACIÓN SIMULADA');
  console.log('================================\n');
  console.log(`Test Plan: ${dryRun.planName}`);
  console.log(`Organización: ${dryRun.target.organization}`);
  console.log(`Proyecto: ${dryRun.target.project}`);
  console.log(`Área: ${dryRun.target.areaPath ?? '(heredada por Azure)'}`);
  console.log(
    `Modo: ${dryRun.target.existingPlanId ? `plan existente #${dryRun.target.existingPlanId}` : 'crear plan nuevo'}`
  );
  console.log(
    `Suite padre: ${dryRun.target.parentSuiteId ?? '(raíz del plan)'}`
  );
  console.log(
    `Testers predeterminados: ${dryRun.target.defaultTesterIds.length > 0 ? dryRun.target.defaultTesterIds.join(', ') : '(sin asignación)'}`
  );
  console.log(`Feature: ${dryRun.featureId}`);
  console.log(`Iteration Path: ${dryRun.iterationPath}`);
  console.log(`Requirement-based Suites: ${dryRun.suites.length}`);
  console.log(`Test Cases: ${dryRun.totalTestCases}`);
  console.log(`Configuraciones utilizadas: ${dryRun.configurationCount}`);
  console.log(`Test Points estimados: ${dryRun.totalTestPoints}`);
  console.log(`Política de casos existentes: ${dryRun.target.existingTestCasePolicy}`);
  console.log(`Casos históricos enlazados: ${dryRun.totalExistingLinkedTestCases}`);
  console.log(`Casos históricos únicos: ${dryRun.uniqueExistingLinkedTestCases}`);
  console.log(`Casos a reutilizar: ${dryRun.totalReusedTestCases}`);
  console.log(`Casos nuevos a crear: ${dryRun.totalNewTestCases}`);
  console.log(`Casos visibles estimados: ${dryRun.expectedVisibleTestCases}`);
  if (dryRun.testPointsAreMinimum) {
    console.log('Test Points: mínimo estimado; Azure conservará puntos de casos históricos no reutilizados.');
  }
  console.log(dryRun.testCaseSequence.count > 0
    ? `Numeración Test Cases: ${dryRun.testCaseSequence.first}–${dryRun.testCaseSequence.last} (máximo existente: ${dryRun.testCaseSequence.highestExisting})`
    : `Numeración Test Cases: sin números nuevos (máximo existente: ${dryRun.testCaseSequence.highestExisting})`
  );

  for (const suite of dryRun.suites) {
    console.log(`\n📁 ${suite.name}`);
    console.log(`   Requirement: ${suite.requirementId}`);
    console.log(`   Test Cases: ${suite.testCases}`);
    console.log(`   Test Points: ${suite.testPoints}`);
    console.log(`   Históricos: ${suite.existingLinkedTestCases.length}`);
    console.log(`   Reutilizados: ${suite.reusedTestCases}`);
    console.log(`   Nuevos: ${suite.newTestCases}`);
    if (suite.existingLinkedTestCases.length > 0) {
      console.log(
        `   IDs históricos: ${suite.existingLinkedTestCases.map(item => item.id).join(', ')}`
      );
    }
    console.log(
      `   Configuraciones: ${suite.configurationNames.join(', ')}`
    );
  }

  for (const warning of dryRun.warnings) {
    console.log(`\n⚠️ ${warning}`);
  }

  if (dryRun.errors.length > 0) {
    console.error('\n❌ Dry-run bloqueado:');

    for (const error of dryRun.errors) {
      console.error(`- ${error}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log('\n✅ Dry-run válido.');
  if (!publish) {
    console.log('No se creó ni modificó nada en Azure DevOps.');
    return;
  }

  console.log('\n⚠️ La siguiente acción CREARÁ elementos en Azure DevOps.');
  const readline = createInterface({ input, output });
  const answer = await readline.question('¿Confirmar publicación real? (y/N): ');
  readline.close();

  if (answer.trim().toLocaleLowerCase() !== 'y') {
    console.log('Publicación cancelada. No se creó ni modificó nada.');
    return;
  }

  let journalPath = '';
  const result = await publishTestPlan(
    plan,
    target,
    dryRun.testCaseSequence.first,
    dryRun.suites,
    async progress => {
    journalPath = await savePublicationJournal(
      plan.featureId, progress, 'in-progress'
    );
    }
  );
  journalPath = await savePublicationJournal(
    plan.featureId, result, 'completed'
  );

  console.log('\n✅ Publicación completada.');
  console.log(`Test Plan ID: ${result.planId}`);
  console.log(`Suites creadas: ${result.suites.length}`);
  console.log(
    `Test Cases creados: ${result.suites.reduce((sum, suite) => sum + suite.testCaseIds.length, 0)}`
  );
  console.log(
    `Test Cases reutilizados: ${result.suites.reduce((sum, suite) => sum + suite.reusedTestCaseIds.length, 0)}`
  );
  console.log(`Registro local: ${journalPath}`);
}

main().catch(error => {
  console.error('\n❌ Error validando publicación');
  console.error(error);
  process.exit(1);
});
