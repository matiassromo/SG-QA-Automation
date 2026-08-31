import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { GeneratedTestPlan } from '../ai/testPlanSchema';

const PREVIEW_DIRECTORY = path.join(
  'generated',
  'test-plans'
);

export async function saveTestPlanPreview(
  plan: GeneratedTestPlan
): Promise<string> {
  const directory = path.resolve(PREVIEW_DIRECTORY);
  const filePath = path.join(
    directory,
    `feature-${plan.featureId}.json`
  );

  await mkdir(directory, { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(plan, null, 2),
    'utf8'
  );

  return filePath;
}
