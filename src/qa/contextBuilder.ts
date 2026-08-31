import mammoth from 'mammoth';

import { azureConnection, azureProject } from '../azure/client';
import { htmlToText } from '../utils/html';
import { extractFigmaReferences } from './figmaReferences';
import { buildDesignContexts } from '../design/buildDesignContexts';
import { getTestConfigurations } from '../azure/testConfigurations';

import {
  QaContext,
  QaTask,
  QaUserStory,
} from '../types/qaContext';


function extractWorkItemId(url?: string): number | null {
  if (!url) {
    return null;
  }

  const match = url.match(/workItems\/(\d+)$/);

  return match ? Number(match[1]) : null;
}


async function getWorkItem(id: number) {
  const witApi = await azureConnection.getWorkItemTrackingApi();

  return witApi.getWorkItem(
    id,
    undefined,
    undefined,
    4,
    azureProject
  );
}


async function findEpic(startId: number) {
  let currentId = startId;

  while (true) {
    const workItem = await getWorkItem(currentId);

    const type =
      workItem.fields?.['System.WorkItemType'];

    if (type === 'Epic') {
      return workItem;
    }

    const parentRelation =
      workItem.relations?.find(
        relation =>
          relation.rel ===
          'System.LinkTypes.Hierarchy-Reverse'
      );

    const parentId =
      extractWorkItemId(parentRelation?.url);

    if (!parentId) {
      throw new Error(
        `No se encontró Epic padre desde Work Item ${startId}`
      );
    }

    currentId = parentId;
  }
}


async function getTasks(
  workItem: any
): Promise<QaTask[]> {

  const taskIds =
    workItem.relations
      ?.filter(
        (relation: any) =>
          relation.rel ===
          'System.LinkTypes.Hierarchy-Forward'
      )
      .map((relation: any) =>
        extractWorkItemId(relation.url)
      )
      .filter(
        (id: number | null): id is number =>
          id !== null
      ) ?? [];

  if (taskIds.length === 0) {
    return [];
  }

  const witApi =
    await azureConnection.getWorkItemTrackingApi();

  const tasks = await witApi.getWorkItems(
    taskIds,
    undefined,
    undefined,
    undefined,
    undefined,
    azureProject
  );

  return tasks.map(task => ({
    id: task.id!,
    title:
      task.fields?.['System.Title'] ?? '',
    state:
      task.fields?.['System.State'] ?? '',
  }));
}


async function getUserStories(
  feature: any
): Promise<QaUserStory[]> {

  const ids =
    feature.relations
      ?.filter(
        (relation: any) =>
          relation.rel ===
          'System.LinkTypes.Hierarchy-Forward'
      )
      .map((relation: any) =>
        extractWorkItemId(relation.url)
      )
      .filter(
        (id: number | null): id is number =>
          id !== null
      ) ?? [];

  if (ids.length === 0) {
    return [];
  }

  const witApi =
    await azureConnection.getWorkItemTrackingApi();

  const workItems = await witApi.getWorkItems(
    ids,
    undefined,
    undefined,
    4,
    undefined,
    azureProject
  );

  const stories: QaUserStory[] = [];

  for (const item of workItems) {

    const type =
      item.fields?.['System.WorkItemType'];

    if (
      type !== 'Product Backlog Item' &&
      type !== 'User Story'
    ) {
      continue;
    }

    stories.push({
      id: item.id!,
      title:
        item.fields?.['System.Title'] ?? '',

      state:
        item.fields?.['System.State'] ?? '',

      description: htmlToText(
        item.fields?.['System.Description']
      ),

      acceptanceCriteria: htmlToText(
        item.fields?.[
          'Microsoft.VSTS.Common.AcceptanceCriteria'
        ]
      ),

      tasks: await getTasks(item),

      designReferences: extractFigmaReferences([
        {
          value: item,
          origin: 'user-story',
          sourceWorkItemId: item.id,
        },
      ]),
    });
  }

  return stories;
}


async function downloadRfc(
  epic: any
): Promise<{ name: string; text: string }> {

  const attachments =
    epic.relations?.filter(
      (relation: any) =>
        relation.rel === 'AttachedFile'
    ) ?? [];

  if (attachments.length === 0) {
    throw new Error(
      `La Epic ${epic.id} no tiene adjuntos`
    );
  }

  const docx =
    attachments.find((attachment: any) =>
      attachment.attributes?.name
        ?.toLowerCase()
        .endsWith('.docx')
    );

  if (!docx) {
    throw new Error(
      `No se encontró un RFC DOCX en Epic ${epic.id}`
    );
  }

  const pat = process.env.AZURE_DEVOPS_PAT!;

  const authorization =
    Buffer.from(`:${pat}`).toString('base64');

  const response = await fetch(
    `${docx.url}?download=true`,
    {
      headers: {
        Authorization: `Basic ${authorization}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `No se pudo descargar RFC: ${response.status}`
    );
  }

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  const extracted =
    await mammoth.extractRawText({
      buffer,
    });

  return {
    name: docx.attributes?.name ?? 'RFC.docx',
    text: extracted.value.trim(),
  };
}


export async function buildQaContext(
  featureId: number,
  options: { figmaUrls?: string[] } = {}
): Promise<QaContext> {

  console.log(
    `\n🔎 Analizando Feature ${featureId}...`
  );

  const feature =
    await getWorkItem(featureId);

  if (
    feature.fields?.['System.WorkItemType']
    !== 'Feature'
  ) {
    throw new Error(
      `El Work Item ${featureId} no es una Feature`
    );
  }

  console.log(
    `✓ Feature: ${feature.fields?.['System.Title']}`
  );

  const stories =
    await getUserStories(feature);

  console.log(
    `✓ ${stories.length} HUs encontradas`
  );

  const epic =
    await findEpic(featureId);

  console.log(
    `✓ Epic: ${epic.id} - ${epic.fields?.['System.Title']}`
  );

  const rfc =
    await downloadRfc(epic);

  console.log(
    `✓ RFC: ${rfc.name}`
  );

  console.log(
    `✓ ${rfc.text.length} caracteres extraídos del RFC`
  );

  const designReferences = extractFigmaReferences([
    ...(options.figmaUrls ?? []).map(url => ({
      value: url,
      origin: 'cli' as const,
    })),
    {
      value: feature,
      origin: 'feature' as const,
      sourceWorkItemId: feature.id,
    },
    {
      value: epic,
      origin: 'epic' as const,
      sourceWorkItemId: epic.id,
    },
    ...stories.flatMap(story =>
      story.designReferences.map(reference => ({
        value: reference.url,
        origin: 'user-story' as const,
        sourceWorkItemId: story.id,
      }))
    ),
  ]);

  console.log(
    `✓ ${designReferences.length} referencias Figma encontradas`
  );

  const designContexts = await buildDesignContexts(
    designReferences,
    {
      searchTerms: [
        feature.fields?.['System.Title'] ?? '',
        epic.fields?.['System.Title'] ?? '',
      ],
    }
  );

  const resolvedDesignReferences = designContexts.map(
    design => design.reference
  );

  for (const design of designContexts) {
    console.log(
      `✓ Figma ${design.platform}: ${design.fileName} / ${design.rootNode.name} ` +
      `(${design.analyzedNodeCount} nodos)`
    );
  }

  const availableConfigurations =
    await getTestConfigurations();

  console.log(
    `✓ ${availableConfigurations.length} configuraciones de Test Plans encontradas`
  );

  return {
    feature: {
      id: feature.id!,
      title:
        feature.fields?.['System.Title'] ?? '',
      state:
        feature.fields?.['System.State'] ?? '',
      iterationPath:
        feature.fields?.['System.IterationPath'] ?? azureProject,
    },

    epic: {
      id: epic.id!,
      title:
        epic.fields?.['System.Title'] ?? '',
    },

    userStories: stories,

    rfc,

    designReferences: resolvedDesignReferences,

    designContexts,

    availableConfigurations,
  };
}
