import { AzureListResponse, AzureRestTarget, azureGet } from './restClient';

export interface ExistingTestPlanSummary {
  id: number;
  name: string;
  state?: string;
}

export async function validateClassificationPath(
  kind: 'Areas' | 'Iterations',
  fullPath: string,
  target: AzureRestTarget
): Promise<string | null> {
  const parts = fullPath.split('\\').filter(Boolean);
  if (parts[0]?.toLocaleLowerCase() === target.project.toLocaleLowerCase()) {
    parts.shift();
  }
  const suffix = parts.length > 0
    ? `/${parts.map(encodeURIComponent).join('/')}`
    : '';
  try {
    await azureGet(
      `/_apis/wit/classificationnodes/${kind}${suffix}`,
      { 'api-version': '7.1' },
      target
    );
    return null;
  } catch {
    return `No existe ${kind === 'Areas' ? 'el Area Path' : 'el Iteration Path'} "${fullPath}" en ${target.organization}/${target.project}`;
  }
}

interface AzureTestPlan {
  id: number;
  name: string;
  state?: string;
  iteration?: string;
  rootSuite?: { id: number; name: string };
}

interface AzureTestSuite {
  id: number;
  name: string;
  requirementId?: number;
}

export interface LinkedTestCase {
  id: number;
  title: string;
}

export async function getLinkedTestCasesByRequirement(
  requirementIds: number[],
  target: AzureRestTarget
): Promise<Map<number, LinkedTestCase[]>> {
  const uniqueIds = [...new Set(requirementIds)];
  const requirements = await azureGet<AzureListResponse<any>>(
    '/_apis/wit/workitems',
    {
      ids: uniqueIds.join(','),
      '$expand': 'Relations',
      'api-version': '7.1',
    },
    target
  );
  const idsByRequirement = new Map<number, number[]>();
  const allTestCaseIds = new Set<number>();

  for (const requirement of requirements.data.value) {
    const ids = (requirement.relations ?? [])
      .filter((relation: any) =>
        relation.rel === 'Microsoft.VSTS.Common.TestedBy-Forward'
      )
      .map((relation: any) => {
        const match = String(relation.url ?? '').match(/workItems\/(\d+)/i);
        return match ? Number(match[1]) : null;
      })
      .filter((id: number | null): id is number => id !== null);
    idsByRequirement.set(requirement.id, [...new Set<number>(ids)]);
    ids.forEach((id: number) => allTestCaseIds.add(id));
  }

  const titles = new Map<number, string>();
  const allIds = [...allTestCaseIds];
  for (let index = 0; index < allIds.length; index += 200) {
    const batch = allIds.slice(index, index + 200);
    if (batch.length === 0) continue;
    const response = await azureGet<AzureListResponse<any>>(
      '/_apis/wit/workitems',
      {
        ids: batch.join(','),
        fields: 'System.Title,System.WorkItemType',
        'api-version': '7.1',
      },
      target
    );
    for (const item of response.data.value) {
      if (item.fields?.['System.WorkItemType'] === 'Test Case') {
        titles.set(item.id, String(item.fields?.['System.Title'] ?? ''));
      }
    }
  }

  return new Map(uniqueIds.map(requirementId => [
    requirementId,
    (idsByRequirement.get(requirementId) ?? [])
      .filter(id => titles.has(id))
      .map(id => ({ id, title: titles.get(id)! })),
  ]));
}

export async function getTestPlanById(id: number, target: AzureRestTarget) {
  const response = await azureGet<AzureTestPlan>(
    `/_apis/testplan/plans/${id}`,
    { 'api-version': '7.1' },
    target
  );
  return response.data;
}

export async function getTestSuitesForPlan(
  planId: number,
  target: AzureRestTarget
) {
  const suites: AzureTestSuite[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await azureGet<AzureListResponse<AzureTestSuite>>(
      `/_apis/testplan/Plans/${planId}/suites`,
      { 'api-version': '7.1', continuationToken, asTreeView: 'false' },
      target
    );
    suites.push(...response.data.value);
    continuationToken = response.continuationToken;
  } while (continuationToken);
  return suites;
}

export async function findTestPlansByName(
  name: string,
  target?: AzureRestTarget
): Promise<ExistingTestPlanSummary[]> {
  const matches: ExistingTestPlanSummary[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await azureGet<AzureListResponse<AzureTestPlan>>(
      '/_apis/testplan/plans',
      {
        'api-version': '7.1',
        continuationToken,
        includePlanDetails: 'true',
      },
      target
    );

    matches.push(
      ...response.data.value
        .filter(plan =>
          plan.name.trim().toLocaleLowerCase() ===
          name.trim().toLocaleLowerCase()
        )
        .map(plan => ({
          id: plan.id,
          name: plan.name,
          state: plan.state,
        }))
    );

    continuationToken = response.continuationToken;
  } while (continuationToken);

  return matches;
}

function getParentId(relations: any[] | undefined): number | null {
  const parent = relations?.find(
    relation =>
      relation.rel === 'System.LinkTypes.Hierarchy-Reverse'
  );
  const match = parent?.url?.match(/workItems\/(\d+)$/);

  return match ? Number(match[1]) : null;
}

export async function validateRequirementWorkItems(
  requirementIds: number[],
  featureId: number,
  target?: AzureRestTarget
): Promise<string[]> {
  const uniqueIds = Array.from(new Set(requirementIds));
  const response = await azureGet<AzureListResponse<any>>(
    '/_apis/wit/workitems',
    {
      ids: uniqueIds.join(','),
      '$expand': 'Relations',
      'api-version': '7.1',
    },
    target
  );
  const workItems = response.data.value;
  const workItemsById = new Map(
    workItems.map(workItem => [workItem.id, workItem])
  );
  const errors: string[] = [];

  for (const id of uniqueIds) {
    const workItem = workItemsById.get(id);

    if (!workItem) {
      errors.push(`No existe el Work Item ${id}`);
      continue;
    }

    const type = workItem.fields?.['System.WorkItemType'];

    if (type !== 'Product Backlog Item' && type !== 'User Story') {
      errors.push(
        `El Work Item ${id} es ${type ?? 'tipo desconocido'}, no una HU/PBI`
      );
    }

    const parentId = getParentId(workItem.relations);

    if (parentId !== featureId) {
      errors.push(
        `La HU/PBI ${id} no es hija directa de la Feature ${featureId}`
      );
    }
  }

  return errors;
}
