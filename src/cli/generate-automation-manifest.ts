import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { generatedTestPlanSchema } from '../ai/testPlanSchema';
import { buildAutomationManifest } from '../automation/buildAutomationManifest';

async function main() {
  const [previewPath, journalPath] = process.argv.slice(2);
  if (!previewPath || !journalPath) {
    throw new Error(
      'Uso: npm run qa:automation:plan -- <PREVIEW_JSON> <PUBLICATION_JOURNAL_JSON>'
    );
  }
  const plan = generatedTestPlanSchema.parse(
    JSON.parse(await readFile(previewPath, 'utf8'))
  );
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  const manifest = buildAutomationManifest(
    plan, journal, previewPath, journalPath
  );
  const directory = path.resolve('generated', 'automation');
  await mkdir(directory, { recursive: true });
  const outputPath = path.join(
    directory,
    `feature-${manifest.featureId}-plan-${manifest.planId}.json`
  );
  await writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`Manifiesto: ${outputPath}`);
  console.log(`Casos totales: ${manifest.summary.totalTestCases}`);
  console.log(`Candidatos: ${manifest.summary.automationCandidates}`);
  console.log(`Elegibles Playwright: ${manifest.summary.playwrightEligible}`);
  console.log(
    `Requieren definir runner: ${manifest.summary.runnerDefinitionRequired}`
  );
}

main().catch(error => {
  console.error('Error generando manifiesto de automatización:', error);
  process.exit(1);
});
