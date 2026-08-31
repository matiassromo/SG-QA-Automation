import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AutomationManifest } from './automationManifestSchema';

export async function generatePlaywrightScaffolds(
  manifest: AutomationManifest,
  outputRoot = path.resolve('generated', 'automation', 'scaffolds')
) {
  const directory = path.join(
    outputRoot,
    `feature-${manifest.featureId}-plan-${manifest.planId}`
  );
  await mkdir(directory, { recursive: true });
  const eligible = manifest.cases.filter(item => item.playwrightEligible);
  const byRequirement = new Map<number, typeof eligible>();

  for (const testCase of eligible) {
    byRequirement.set(testCase.requirementId, [
      ...(byRequirement.get(testCase.requirementId) ?? []),
      testCase,
    ]);
  }

  const files: string[] = [];
  for (const [requirementId, testCases] of byRequirement) {
    const filePath = path.join(directory, `hu-${requirementId}.spec.ts`);
    await writeFile(filePath, renderSpec(requirementId, testCases), 'utf8');
    files.push(filePath);
  }

  const pendingPath = path.join(directory, 'runner-definition-required.json');
  await writeFile(
    pendingPath,
    JSON.stringify(
      manifest.cases.filter(item => !item.playwrightEligible),
      null,
      2
    ) + '\n',
    'utf8'
  );
  files.push(pendingPath);
  return { directory, files, eligible: eligible.length };
}

function renderSpec(
  requirementId: number,
  testCases: AutomationManifest['cases']
) {
  const blocks = testCases.map(testCase => {
    const steps = testCase.steps.map((step, index) => `
    await test.step(${quote(`Paso ${index + 1}: ${step.action}`)}, async () => {
      // Acción manual de referencia: ${safeComment(step.action)}
      // Resultado esperado: ${safeComment(step.expected)}
      // TODO: implementar con Page Objects y locators confirmados en el aplicativo.
    });`).join('\n');
    const webTargets = testCase.executionTargets
      .filter(target => target.runner === 'playwright-web')
      .map(target => target.configurationName)
      .join(', ');
    return `
  test(${quote(`[ADO:${testCase.azureTestCaseId}] ${testCase.title}`)}, async ({ page }) => {
    test.fixme(true, ${quote('Pendiente descubrir selectores y completar Page Objects')});
    test.info().annotations.push(
      { type: 'azure-test-case-id', description: ${quote(String(testCase.azureTestCaseId))} },
      { type: 'requirement-id', description: ${quote(String(requirementId))} },
      { type: 'configurations', description: ${quote(webTargets)} }
    );
    void page;
${steps}
  });`;
  }).join('\n');

  return `import { test } from '@playwright/test';

test.describe(${quote(`HU ${requirementId} - scaffolds generados`)}, () => {${blocks}
});
`;
}

function quote(value: string) {
  return JSON.stringify(value);
}

function safeComment(value: string) {
  return value.replace(/\r?\n/g, ' ').replace(/\*\//g, '* /');
}
