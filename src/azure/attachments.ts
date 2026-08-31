import { azureConnection, azureProject } from './client';

async function getWorkItemWithRelations(id: number) {
  const witApi = await azureConnection.getWorkItemTrackingApi();

  return witApi.getWorkItem(
    id,
    undefined,
    undefined,
    4,
    azureProject
  );
}

function getParentId(workItem: any): number | null {
  const parentRelation = workItem.relations?.find(
    (relation: any) =>
      relation.rel === 'System.LinkTypes.Hierarchy-Reverse'
  );

  if (!parentRelation?.url) {
    return null;
  }

  const match = parentRelation.url.match(/workItems\/(\d+)$/);

  return match ? Number(match[1]) : null;
}

async function findEpic(startWorkItemId: number) {
  let currentId = startWorkItemId;

  while (true) {
    const workItem = await getWorkItemWithRelations(currentId);

    const type = workItem.fields?.['System.WorkItemType'];
    const title = workItem.fields?.['System.Title'];

    console.log(
      `Revisando ${currentId} | ${type} | ${title}`
    );

    if (type === 'Epic') {
      return workItem;
    }

    const parentId = getParentId(workItem);

    if (!parentId) {
      throw new Error(
        `No se encontró una Épica padre para el Work Item ${startWorkItemId}`
      );
    }

    currentId = parentId;
  }
}

async function listRfcAttachments(startWorkItemId: number) {
  const epic = await findEpic(startWorkItemId);

  console.log('\nEPIC ENCONTRADA');
  console.log({
    id: epic.id,
    title: epic.fields?.['System.Title'],
  });

  const attachments =
    epic.relations?.filter(
      (relation: any) => relation.rel === 'AttachedFile'
    ) ?? [];

  if (attachments.length === 0) {
    console.log('\nNo se encontraron adjuntos en la Épica.');
    return;
  }

  console.log('\nADJUNTOS');

  for (const attachment of attachments) {
    console.log('------------------------------');
    console.log(`Nombre: ${attachment.attributes?.name}`);
    console.log(`URL: ${attachment.url}`);
  }
}

listRfcAttachments(1965).catch(error => {
  console.error('Error:');
  console.error(error);
});