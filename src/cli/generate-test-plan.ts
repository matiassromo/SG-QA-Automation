import path from 'node:path';

import { buildQaContext } from '../qa/contextBuilder';
import { generateTestPlan } from '../ai/generateTestPlan';
import { saveTestPlanPreview } from '../qa/testPlanPreview';

function getFeatureId(args: string[]): number {
  const featureFlagIndex = args.indexOf('--feature');
  const featureFlag = args.find(argument =>
    argument.startsWith('--feature=')
  );

  const rawFeatureId = featureFlagIndex >= 0
    ? args[featureFlagIndex + 1]
    : featureFlag?.slice('--feature='.length) ?? args[0];

  const featureId = Number(rawFeatureId);

  if (!Number.isInteger(featureId) || featureId <= 0) {
    throw new Error(
      'Uso: npm run qa:generate -- --feature <FEATURE_ID>'
    );
  }

  return featureId;
}

function getFigmaUrls(args: string[]): string[] {
  return args.flatMap((argument, index) => {
    if (argument === '--figma-url') {
      return args[index + 1] ? [args[index + 1]] : [];
    }

    if (argument.startsWith('--figma-url=')) {
      return [argument.slice('--figma-url='.length)];
    }

    return [];
  });
}

async function main() {
  const featureId = getFeatureId(process.argv.slice(2));
  const figmaUrls = getFigmaUrls(process.argv.slice(2));

  console.log(
    `\n🚀 Generando Test Plan para Feature ${featureId}\n`
  );

  const context =
    await buildQaContext(featureId, { figmaUrls });

  console.log(
    '\n🤖 Enviando contexto al modelo...\n'
  );

  const plan =
    await generateTestPlan(context);

  const previewPath =
    await saveTestPlanPreview(plan);

  console.log('\n================================');
  console.log('     TEST PLAN PROPUESTO');
  console.log('================================\n');

  console.log(
    `Nombre: ${plan.testPlanName}`
  );

  console.log(
    `Objetivo: ${plan.objective}`
  );

  console.log(
    `Suites: ${plan.suites.length}`
  );

  const totalTestCases = plan.suites.reduce(
    (total, suite) => total + suite.testCases.length,
    0
  );

  const automationCandidates = plan.suites.reduce(
    (total, suite) =>
      total + suite.testCases.filter(
        testCase => testCase.automationCandidate
      ).length,
    0
  );

  const designLinkedCases = plan.suites.reduce(
    (total, suite) =>
      total + suite.testCases.filter(
        testCase => testCase.designReferences.length > 0
      ).length,
    0
  );

  console.log(`Casos: ${totalTestCases}`);
  console.log(
    `Candidatos a automatización: ${automationCandidates}`
  );
  console.log(
    `Casos con trazabilidad Figma: ${designLinkedCases}`
  );

  for (const suite of plan.suites) {
    console.log(
      `\n📁 ${suite.name}`
    );

    console.log(
      `   Casos: ${suite.testCases.length}`
    );

    for (const testCase of suite.testCases) {
      console.log(
        `   - P${testCase.priority} | ${testCase.type} | ${testCase.title}`
      );
    }
  }

  if (plan.coverageWarnings.length > 0) {
    console.log(
      '\n⚠️ ADVERTENCIAS DE COBERTURA'
    );

    for (const warning of plan.coverageWarnings) {
      console.log(
        `- ${warning.title}`
      );

      console.log(
        `  ${warning.description}`
      );
    }
  }

  console.log(
    '\n✅ Test Plan validado con Zod.'
  );

  console.log(
    `✅ Preview guardado en: ${path.relative(process.cwd(), previewPath)}`
  );

  console.log(
    '\nNo se creó nada en Azure DevOps.'
  );
}

main().catch(error => {
  console.error('\n❌ Error generando Test Plan');
  console.error(error);

  process.exit(1);
});
