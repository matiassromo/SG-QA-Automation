import { buildQaContext } from '../qa/contextBuilder';

async function main() {
  const featureId = Number(process.argv[2]);

  if (!featureId) {
    console.error(
      'Uso: npx tsx src/cli/analyze-feature.ts <FEATURE_ID>'
    );

    process.exit(1);
  }

  const context = await buildQaContext(featureId);

  console.log('\n==============================');
  console.log('       CONTEXTO QA');
  console.log('==============================\n');

  console.log(
    `Feature: ${context.feature.id} - ${context.feature.title}`
  );

  console.log(
    `Epic: ${context.epic.id} - ${context.epic.title}`
  );

  console.log(
    `RFC: ${context.rfc.name}`
  );

  console.log('\nHISTORIAS DE USUARIO');

  for (const story of context.userStories) {
    console.log('\n------------------------------');

    console.log(
      `${story.id} - ${story.title}`
    );

    console.log(
      `Estado: ${story.state}`
    );

    console.log('\nDescripción:');
    console.log(story.description);

    console.log('\nCriterios de aceptación:');
    console.log(story.acceptanceCriteria);

    console.log('\nTasks:');

    for (const task of story.tasks) {
      console.log(
        `  ${task.id} | ${task.state} | ${task.title}`
      );
    }
  }

  console.log('\n==============================');

  console.log(
    `RFC extraído: ${context.rfc.text.length} caracteres`
  );

  console.log('==============================\n');
}

main().catch(error => {
  console.error('\n❌ Error generando contexto QA');
  console.error(error);

  process.exit(1);
});