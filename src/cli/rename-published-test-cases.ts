import { readFile } from 'node:fs/promises';

import { azureRequest } from '../azure/restClient';
import {
  formatSequencedTestCaseTitle,
  getNextTestCaseSequence,
  parseSequencedTestCaseTitle,
} from '../azure/testCaseSequence';
import { publicationTargetFileSchema } from '../qa/publicationTarget';

interface Journal {
  organization: string;
  project: string;
  planId: number;
  suites: Array<{ testCaseIds: number[] }>;
}

interface WorkItem {
  id: number;
  fields?: Record<string, unknown>;
}

async function main() {
  const [journalPath, targetPath, mode] = process.argv.slice(2);
  if (!journalPath || !targetPath || !['--dry-run', 'apply'].includes(mode)) {
    throw new Error(
      'Uso: npm run qa:rename-published -- <JOURNAL_JSON> <TARGET_JSON> (--dry-run | apply)'
    );
  }

  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as Journal;
  const targetFile = publicationTargetFileSchema.parse(
    JSON.parse(await readFile(targetPath, 'utf8'))
  );
  if (
    targetFile.organization !== journal.organization ||
    targetFile.project !== journal.project
  ) {
    throw new Error('El journal y el archivo de destino pertenecen a proyectos diferentes');
  }
  const naming = targetFile.testCaseNaming ?? {
    prefix: 'QA', numberSeparator: ' - TC-', padding: 3, titleSeparator: ' ',
  };
  const azureTarget = {
    organization: journal.organization,
    project: journal.project,
  };
  const ids = journal.suites.flatMap(suite => suite.testCaseIds);
  const excludedIds = new Set(ids);
  const current = await getWorkItems(ids, azureTarget);
  const sequence = await getNextTestCaseSequence(
    azureTarget, naming, excludedIds
  );
  const changes = ids.map((id, index) => {
    const workItem = current.get(id);
    if (!workItem) throw new Error(`No se encontró el Test Case ${id}`);
    const oldTitle = String(workItem.fields?.['System.Title'] ?? '');
    const baseTitle = parseSequencedTestCaseTitle(oldTitle, naming)?.title ?? oldTitle;
    return {
      id,
      oldTitle,
      newTitle: formatSequencedTestCaseTitle(sequence.next + index, baseTitle, naming),
    };
  });

  console.log(`Plan: ${journal.planId}`);
  console.log(`Rango reservado: ${sequence.next}–${sequence.next + changes.length - 1}`);
  for (const change of changes) {
    console.log(`#${change.id}: ${change.oldTitle} -> ${change.newTitle}`);
  }
  if (mode === '--dry-run') {
    console.log('Dry-run: no se modificó nada.');
    return;
  }

  const latest = await getNextTestCaseSequence(
    azureTarget, naming, excludedIds
  );
  if (latest.next !== sequence.next) {
    throw new Error(
      `La secuencia cambió: antes ${sequence.next}, ahora ${latest.next}. Reintente el dry-run.`
    );
  }
  for (const change of changes) {
    if (change.oldTitle === change.newTitle) {
      console.log(`Sin cambios #${change.id}`);
      continue;
    }
    await azureRequest<WorkItem>(
      'PATCH', `/_apis/wit/workitems/${change.id}`, {
        query: { 'api-version': '7.1' },
        target: azureTarget,
        contentType: 'application/json-patch+json',
        body: [{ op: 'replace', path: '/fields/System.Title', value: change.newTitle }],
      }
    );
    console.log(`Renombrado #${change.id}`);
  }
  console.log(`Completado: ${changes.length} Test Cases renombrados.`);
}

async function getWorkItems(
  ids: number[],
  target: { organization: string; project: string }
) {
  const response = await azureRequest<{ value: WorkItem[] }>(
    'GET', '/_apis/wit/workitems', {
      query: {
        ids: ids.join(','),
        fields: 'System.Title',
        'api-version': '7.1',
      },
      target,
    }
  );
  return new Map(response.data.value.map(item => [item.id, item]));
}

main().catch(error => {
  console.error('Error renombrando Test Cases:', error);
  process.exit(1);
});
