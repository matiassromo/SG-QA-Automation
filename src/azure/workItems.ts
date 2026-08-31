import { azureConnection, azureProject } from './client';

async function getFeatureWithDetails(id: number) {
  const witApi = await azureConnection.getWorkItemTrackingApi();

  const feature = await witApi.getWorkItem(
    id,
    undefined,
    undefined,
    4,
    azureProject
  );

  console.log('\nFEATURE');
  console.log({
    id: feature.id,
    type: feature.fields?.['System.WorkItemType'],
    title: feature.fields?.['System.Title'],
    state: feature.fields?.['System.State'],
  });

  const childRelations =
    feature.relations?.filter(
      relation => relation.rel === 'System.LinkTypes.Hierarchy-Forward'
    ) ?? [];

  const childIds = childRelations
    .map(relation => {
      const match = relation.url?.match(/workItems\/(\d+)$/);
      return match ? Number(match[1]) : null;
    })
    .filter((id): id is number => id !== null);

  const children = await witApi.getWorkItems(
    childIds,
    undefined,
    undefined,
    4,
    undefined,
    azureProject
  );

  console.log('\nHISTORIAS / PBIs');

  for (const child of children) {
    console.log('\n------------------------------------');

    console.log({
      id: child.id,
      type: child.fields?.['System.WorkItemType'],
      title: child.fields?.['System.Title'],
      state: child.fields?.['System.State'],
      description: child.fields?.['System.Description'],
      acceptanceCriteria:
        child.fields?.['Microsoft.VSTS.Common.AcceptanceCriteria'],
    });

    const taskRelations =
      child.relations?.filter(
        relation => relation.rel === 'System.LinkTypes.Hierarchy-Forward'
      ) ?? [];

    const taskIds = taskRelations
      .map(relation => {
        const match = relation.url?.match(/workItems\/(\d+)$/);
        return match ? Number(match[1]) : null;
      })
      .filter((taskId): taskId is number => taskId !== null);

    if (taskIds.length === 0) {
      console.log('Tasks: ninguna');
      continue;
    }

    const tasks = await witApi.getWorkItems(
      taskIds,
      undefined,
      undefined,
      undefined,
      undefined,
      azureProject
    );

    console.log('Tasks:');

    for (const task of tasks) {
      console.log(
        `  - ${task.id} | ${task.fields?.['System.Title']} | ${task.fields?.['System.State']}`
      );
    }
  }
}

getFeatureWithDetails(1965).catch((error) => {
  console.error('Error consultando Azure DevOps:');
  console.error(error);
});