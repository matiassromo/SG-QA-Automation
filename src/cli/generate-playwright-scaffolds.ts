import { readFile } from 'node:fs/promises';

import { automationManifestSchema } from '../automation/automationManifestSchema';
import { generatePlaywrightScaffolds } from '../automation/generatePlaywrightScaffolds';

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error(
      'Uso: npm run qa:automation:scaffold -- <AUTOMATION_MANIFEST_JSON>'
    );
  }
  const manifest = automationManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, 'utf8'))
  );
  const result = await generatePlaywrightScaffolds(manifest);
  console.log(`Directorio: ${result.directory}`);
  console.log(`Scaffolds Playwright: ${result.eligible}`);
  console.log(`Archivos generados: ${result.files.length}`);
  console.log('Todos los specs están marcados test.fixme; no se ejecutarán hasta completar selectores.');
}

main().catch(error => {
  console.error('Error generando scaffolds Playwright:', error);
  process.exit(1);
});
