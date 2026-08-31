import 'dotenv/config';

import { azureRequest } from '../azure/restClient';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const organization = args.organization ?? process.env.AZURE_DEVOPS_ORG;
  const project = args.project ?? process.env.AZURE_DEVOPS_PROJECT;
  const runIds = String(args.runs ?? '').split(',').map(Number);
  if (!organization || !project) throw new Error('Falta organización o proyecto.');
  if (!runIds.length || runIds.some(id => !Number.isInteger(id) || id <= 0)) {
    throw new Error('--runs debe contener IDs positivos separados por coma.');
  }
  if (args.apply !== 'true') {
    console.log(`Dry-run: se eliminarían ${runIds.length} Runs de ${organization}/${project}: ${runIds.join(', ')}`);
    return;
  }
  const deleted: number[] = [];
  const failed: Array<{ id: number; error: string }> = [];
  for (const id of runIds) {
    try {
      await azureRequest('DELETE', `/_apis/test/runs/${id}`, {
        target: { organization, project }, query: { 'api-version': '7.1' },
      });
      deleted.push(id);
      console.log(`ELIMINADO Run ${id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ id, error: message });
      console.error(`NO ELIMINADO Run ${id}: ${message}`);
    }
  }
  console.log(`Resumen: ${deleted.length} eliminados, ${failed.length} no eliminados.`);
  if (failed.length) process.exitCode = 2;
}

function parseArgs(items: string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < items.length; index += 1) {
    if (items[index] === '--apply') { values.apply = 'true'; continue; }
    const key = items[index].replace(/^--/, '');
    const value = items[index + 1];
    if (!items[index].startsWith('--') || !value) throw new Error(`Argumento inválido: ${items[index]}`);
    values[key] = value; index += 1;
  }
  return values;
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
