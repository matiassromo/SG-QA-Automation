import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PublicationResult } from '../azure/testPlanPublisher';

export async function savePublicationJournal(
  featureId: number,
  result: PublicationResult,
  status: 'in-progress' | 'completed'
) {
  const directory = path.resolve('generated', 'publications');
  await mkdir(directory, { recursive: true });
  const filePath = path.join(
    directory,
    `feature-${featureId}-plan-${result.planId}-${result.organization}-${result.project}.json`
      .replace(/[^a-zA-Z0-9._-]/g, '-')
  );
  await writeFile(filePath, JSON.stringify({
    status,
    updatedAt: new Date().toISOString(),
    ...result,
  }, null, 2) + '\n', 'utf8');
  return filePath;
}
