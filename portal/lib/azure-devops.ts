import 'server-only';
import { assertProjectContext, ProjectContext } from './project-context';

type AzureList<T> = { count?: number; value?: T[] };

function credentials() {
  const organization = process.env.AZURE_DEVOPS_ORG;
  const pat = process.env.AZURE_DEVOPS_PAT;
  if (!organization || !pat) throw new Error('Faltan AZURE_DEVOPS_ORG o AZURE_DEVOPS_PAT en el entorno local.');
  return { organization, authorization: `Basic ${btoa(`:${pat}`)}` };
}

export async function resolveProjectContext(projectName: string): Promise<ProjectContext> {
  const { organization } = credentials();
  const project = await request<Record<string, unknown>>(
    null, `/_apis/projects/${encodeURIComponent(projectName)}`, { 'api-version': '7.1' },
  );
  const types = await request<AzureList<Record<string, unknown>>>(
    projectName, '/_apis/wit/workitemtypes', { 'api-version': '7.1' },
  );
  const candidates = (types.value ?? [])
    .map(item => String(item.name ?? ''))
    .filter(name => /^(User Story|Product Backlog Item|Requirement)$/i.test(name));
  return assertProjectContext({
    organization,
    projectId: String(project.id ?? ''),
    projectName: String(project.name ?? projectName),
    areaPath: String(project.name ?? projectName),
    requirementTypes: candidates,
  });
}

async function request<T>(project: string | null, path: string, query: Record<string, string> = {}, init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; contentType?: string } = {}) {
  const { organization, authorization } = credentials();
  const projectPart = project ? `/${encodeURIComponent(project)}` : '';
  const url = new URL(`https://dev.azure.com/${encodeURIComponent(organization)}${projectPart}${path}`);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { Authorization: authorization, Accept: 'application/json', ...(init.body ? { 'Content-Type': init.contentType ?? 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = '';
    try {
      const payload = JSON.parse(text) as { message?: string };
      detail = String(payload.message ?? '').trim();
    } catch { detail = text.trim().slice(0, 500); }
    throw new Error(`Azure DevOps respondió HTTP ${response.status} al consultar ${path}.${detail ? ` ${detail}` : ''}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function downloadWorkItemAttachment(project: string, attachmentId: string) {
  const { organization, authorization } = credentials();
  const url = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/wit/attachments/${encodeURIComponent(attachmentId)}?api-version=7.1`;
  const response = await fetch(url, { headers: { Authorization: authorization }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Azure DevOps respondió HTTP ${response.status} al descargar el adjunto.`);
  return { data: await response.arrayBuffer(), contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
}

export async function getProjectOverview(project: string) {
  const [projectInfo, plans, configurations, wiql] = await Promise.all([
    request<Record<string, unknown>>(null, `/_apis/projects/${encodeURIComponent(project)}`, { 'api-version': '7.1' }),
    listPlans(project),
    request<AzureList<Record<string, unknown>>>(project, '/_apis/testplan/configurations', { 'api-version': '7.1', '$top': '1000' }),
    request<{ workItems?: Array<{ id: number }> }>(project, '/_apis/wit/wiql', { 'api-version': '7.1', '$top': '500' }, {
      method: 'POST', body: { query: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.ChangedDate] DESC" },
    }),
  ]);
  const ids = (wiql.workItems ?? []).map(item => item.id);
  const items: Record<string, unknown>[] = [];
  for (let index = 0; index < ids.length; index += 200) {
    const batch = await request<AzureList<Record<string, unknown>>>(project, '/_apis/wit/workitems', {
      ids: ids.slice(index, index + 200).join(','),
      fields: 'System.Id,System.Title,System.WorkItemType,System.State,System.AssignedTo,System.IterationPath,System.ChangedDate',
      'api-version': '7.1',
    });
    items.push(...(batch.value ?? []));
  }
  const normalized = items.map(item => {
    const fields = (item.fields ?? {}) as Record<string, unknown>;
    const assigned = fields['System.AssignedTo'] as Record<string, unknown> | undefined;
    return { id: Number(item.id), title: String(fields['System.Title'] ?? ''), type: String(fields['System.WorkItemType'] ?? ''), state: String(fields['System.State'] ?? ''), assignedTo: String(assigned?.displayName ?? ''), iteration: String(fields['System.IterationPath'] ?? ''), changedDate: String(fields['System.ChangedDate'] ?? '') };
  });
  const counts = normalized.reduce<Record<string, number>>((result, item) => { result[item.type] = (result[item.type] ?? 0) + 1; return result; }, {});
  return {
    project: { id: String(projectInfo.id ?? ''), name: String(projectInfo.name ?? project), description: String(projectInfo.description ?? ''), state: String(projectInfo.state ?? ''), visibility: String(projectInfo.visibility ?? ''), lastUpdateTime: String(projectInfo.lastUpdateTime ?? '') },
    counts, plansCount: plans.length, configurationsCount: configurations.value?.length ?? 0,
    recentRequirements: normalized.filter(item => ['User Story', 'Product Backlog Item', 'Feature', 'Epic'].includes(item.type)).slice(0, 12),
  };
}

function plainText(value: unknown) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseManualSteps(value: unknown) {
  const xml = String(value ?? '');
  const result: Array<{ action: string; expected: string }> = [];
  for (const match of xml.matchAll(/<step\b[^>]*>([\s\S]*?)<\/step>/gi)) {
    const values = [...match[1].matchAll(/<parameterizedString\b[^>]*>([\s\S]*?)<\/parameterizedString>/gi)];
    result.push({ action: plainText(values[0]?.[1]), expected: plainText(values[1]?.[1]) });
  }
  return result.filter(step => step.action || step.expected);
}

export async function getProjectRequirements(context: ProjectContext) {
  assertProjectContext(context);
  const project = context.projectName;
  const escapedTypes = context.requirementTypes.map(type => `'${type.replace(/'/g, "''")}'`).join(',');
  const [wiql, areaTree, iterationTree] = await Promise.all([
    request<{ workItems?: Array<{ id: number }> }>(project, '/_apis/wit/wiql', {
      'api-version': '7.1', '$top': '1000',
    }, { method: 'POST', body: { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND ([System.WorkItemType] IN ('Epic','Feature') OR [System.WorkItemType] IN (${escapedTypes})) ORDER BY [System.ChangedDate] DESC` } }),
    request<Record<string, unknown>>(project, '/_apis/wit/classificationnodes/Areas', { 'api-version': '7.1', '$depth': '10' }),
    request<Record<string, unknown>>(project, '/_apis/wit/classificationnodes/Iterations', { 'api-version': '7.1', '$depth': '10' }),
  ]);
  const ids = (wiql.workItems ?? []).map(item => item.id);
  const workItems: Record<string, unknown>[] = [];
  for (let index = 0; index < ids.length; index += 200) {
    const batch = await request<AzureList<Record<string, unknown>>>(project, '/_apis/wit/workitems', {
      ids: ids.slice(index, index + 200).join(','), '$expand': 'Relations', 'api-version': '7.1',
    });
    workItems.push(...(batch.value ?? []));
  }
  const nodes = workItems.map(item => {
    const fields = (item.fields ?? {}) as Record<string, unknown>;
    const assigned = fields['System.AssignedTo'] as Record<string, unknown> | undefined;
    const relations = (item.relations ?? []) as Array<{ rel?: string; url?: string; attributes?: { name?: string; comment?: string } }>;
    const parent = relations.find(relation => relation.rel === 'System.LinkTypes.Hierarchy-Reverse');
    const parentId = Number(parent?.url?.match(/workItems\/(\d+)$/i)?.[1] ?? 0) || null;
    const testCaseIds = relations.filter(relation => relation.rel === 'Microsoft.VSTS.Common.TestedBy-Forward').map(relation => Number(relation.url?.match(/workItems\/(\d+)$/i)?.[1] ?? 0)).filter(Boolean);
    const attachments = relations.filter(relation => relation.rel === 'AttachedFile').map(relation => ({
      id: String(relation.url?.match(/attachments\/([^/?]+)(?:\?|$)/i)?.[1] ?? ''),
      name: String(relation.attributes?.name ?? 'Adjunto'), comment: String(relation.attributes?.comment ?? ''),
    })).filter(attachment => attachment.id);
    return {
      id: Number(item.id), parentId, title: String(fields['System.Title'] ?? ''), type: String(fields['System.WorkItemType'] ?? ''),
      state: String(fields['System.State'] ?? ''), assignedTo: String(assigned?.displayName ?? ''), iteration: String(fields['System.IterationPath'] ?? ''),
      area: String(fields['System.AreaPath'] ?? ''), priority: Number(fields['Microsoft.VSTS.Common.Priority'] ?? 0) || null,
      description: plainText(fields['System.Description']), acceptanceCriteria: plainText(fields['Microsoft.VSTS.Common.AcceptanceCriteria']),
      testCaseIds: [...new Set(testCaseIds)], attachments, changedDate: String(fields['System.ChangedDate'] ?? ''),
    };
  });
  return { requirements: nodes, classification: {
    areas: classificationPaths(project, areaTree),
    iterations: classificationPaths(project, iterationTree),
  }, summary: {
    epics: nodes.filter(item => item.type === 'Epic').length,
    features: nodes.filter(item => item.type === 'Feature').length,
    stories: nodes.filter(item => context.requirementTypes.includes(item.type)).length,
    coveredStories: nodes.filter(item => context.requirementTypes.includes(item.type) && item.testCaseIds.length > 0).length,
  } };
}

function classificationPaths(project: string, root: Record<string, unknown>) {
  const result = new Set<string>([project]);
  const visit = (node: Record<string, unknown>, prefix: string, isRoot = false) => {
    const name = String(node.name ?? '').trim();
    const path = isRoot ? project : `${prefix}\\${name}`;
    if (name) result.add(path);
    for (const child of (node.children ?? []) as Record<string, unknown>[]) visit(child, path);
  };
  visit(root, project, true);
  return [...result].sort((a, b) => a.localeCompare(b));
}

export async function listProjects() {
  const result = await request<AzureList<Record<string, unknown>>>(null, '/_apis/projects', {
    'api-version': '7.1', '$top': '500', stateFilter: 'all',
  });
  return (result.value ?? []).map(project => ({
    id: String(project.id ?? ''), name: String(project.name ?? ''),
    description: String(project.description ?? ''), state: String(project.state ?? ''),
    visibility: String(project.visibility ?? ''), lastUpdateTime: String(project.lastUpdateTime ?? ''),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listPlans(project: string) {
  const result = await request<AzureList<Record<string, unknown>>>(project, '/_apis/testplan/plans', {
    'api-version': '7.1', includePlanDetails: 'true', '$top': '500',
  });
  return (result.value ?? []).map(plan => {
    const rootSuite = plan.rootSuite as Record<string, unknown> | undefined;
    return { id: Number(plan.id), name: String(plan.name ?? ''), state: String(plan.state ?? ''), areaPath: String(plan.areaPath ?? ''),
      iteration: String(plan.iteration ?? ''), startDate: String(plan.startDate ?? ''), endDate: String(plan.endDate ?? ''),
      rootSuiteId: rootSuite?.id ? Number(rootSuite.id) : null };
  }).sort((a, b) => b.id - a.id);
}

function normalizePlan(plan: Record<string, unknown>, fallback: { name?: string; iteration?: string; areaPath?: string } = {}) {
  const rootSuite = plan.rootSuite as Record<string, unknown> | undefined;
  return {
    id: Number(plan.id), name: String(plan.name ?? fallback.name ?? ''), state: String(plan.state ?? 'Active'), areaPath: String(plan.areaPath ?? fallback.areaPath ?? ''),
    iteration: String(plan.iteration ?? fallback.iteration ?? ''), startDate: String(plan.startDate ?? ''),
    endDate: String(plan.endDate ?? ''), rootSuiteId: rootSuite?.id ? Number(rootSuite.id) : null,
  };
}

export async function createTestPlan(project: string, name: string, iteration: string, description = '') {
  const areaTree = await request<Record<string, unknown>>(project, '/_apis/wit/classificationnodes/Areas', { 'api-version': '7.1', '$depth': '10' });
  const areaPath = classificationPaths(project, areaTree).find(path => path.toLocaleLowerCase() === `${project}\\qa`.toLocaleLowerCase());
  if (!areaPath) throw new Error(`El proyecto ${project} no tiene configurada el área obligatoria ${project}\\QA.`);
  const plan = await request<Record<string, unknown>>(project, '/_apis/testplan/plans', { 'api-version': '7.1' }, {
    method: 'POST', body: { name, iteration, areaPath, state: 'Active', description: description || `Test Plan administrado por SGQA para ${project}.` },
  });
  return normalizePlan(plan, { name, iteration, areaPath });
}

export async function updateTestPlan(project: string, planId: number, input: { name?: string; iteration?: string }) {
  const body = Object.fromEntries(Object.entries(input).filter(([, value]) => String(value ?? '').trim()));
  const plan = await request<Record<string, unknown>>(project, `/_apis/testplan/plans/${planId}`, { 'api-version': '7.1' }, {
    method: 'PATCH', body,
  });
  return normalizePlan(plan, input);
}

export async function deleteTestPlan(project: string, planId: number) {
  await request<void>(project, `/_apis/testplan/plans/${planId}`, { 'api-version': '7.1' }, { method: 'DELETE' });
}

export async function listSuites(project: string, planId: number) {
  const result = await request<AzureList<Record<string, unknown>>>(project, `/_apis/testplan/Plans/${planId}/suites`, {
    'api-version': '7.1', asTreeView: 'false', '$top': '1000',
  });
  return (result.value ?? []).map(suite => ({
    id: Number(suite.id), name: String(suite.name ?? ''), suiteType: String(suite.suiteType ?? ''),
    requirementId: suite.requirementId ? Number(suite.requirementId) : null,
    parentSuiteId: (suite.parentSuite as Record<string, unknown> | undefined)?.id
      ? Number((suite.parentSuite as Record<string, unknown>).id) : null,
  }));
}

export async function ensureRequirementSuites(
  project: string,
  planId: number,
  parentSuiteId: number,
  requirements: Array<{ id: number; title: string }>,
) {
  const existing = await listSuites(project, planId);
  const byRequirement = new Map(existing.filter(suite => suite.requirementId).map(suite => [suite.requirementId, suite]));
  const suites = [] as Awaited<ReturnType<typeof listSuites>>;
  const createdIds: number[] = [];
  const existingIds: number[] = [];
  for (const requirement of requirements) {
    const found = byRequirement.get(requirement.id);
    if (found) {
      suites.push(found);
      existingIds.push(found.id);
      continue;
    }
    const response = await request<Record<string, unknown>>(project, `/_apis/testplan/Plans/${planId}/suites`, { 'api-version': '7.1' }, {
      method: 'POST',
      body: {
        suiteType: 'requirementTestSuite',
        name: `${requirement.id} : ${requirement.title}`,
        requirementId: requirement.id,
        parentSuite: { id: parentSuiteId },
        inheritDefaultConfigurations: true,
      },
    });
    const parentSuite = response.parentSuite as Record<string, unknown> | undefined;
    const created = {
      id: Number(response.id), name: String(response.name ?? `${requirement.id} : ${requirement.title}`),
      suiteType: String(response.suiteType ?? 'RequirementTestSuite'), requirementId: requirement.id,
      parentSuiteId: parentSuite?.id ? Number(parentSuite.id) : parentSuiteId,
    };
    suites.push(created);
    createdIds.push(created.id);
    byRequirement.set(requirement.id, created);
  }
  return { suites, createdIds, existingIds };
}

export async function getSuiteDetails(project: string, planId: number, suiteId: number) {
  const [caseResponse, pointResponse, configurationResponse, allSuites] = await Promise.all([
    request<AzureList<Record<string, unknown>>>(project, `/_apis/testplan/Plans/${planId}/Suites/${suiteId}/TestCase`, {
      'api-version': '7.1', expand: 'true', '$top': '1000',
    }),
    request<AzureList<Record<string, unknown>>>(project, `/_apis/testplan/Plans/${planId}/Suites/${suiteId}/TestPoint`, {
      'api-version': '7.1', includePointDetails: 'true', '$top': '1000',
    }),
    request<AzureList<Record<string, unknown>>>(project, '/_apis/testplan/configurations', {
      'api-version': '7.1', '$top': '1000',
    }),
    listSuites(project, planId),
  ]);

  const points = (pointResponse.value ?? []).map(point => {
    const tc = (point.testCaseReference ?? point.testCase) as Record<string, unknown> | undefined;
    const config = point.configuration as Record<string, unknown> | undefined;
    return { id: Number(point.id), testCaseId: Number(tc?.id ?? 0), configurationId: Number(config?.id ?? 0),
      configurationName: String(config?.name ?? ''), outcome: String(point.outcome ?? ''), state: String(point.state ?? '') };
  });
  const pointsByCase = new Map<number, typeof points>();
  for (const point of points) pointsByCase.set(point.testCaseId, [...(pointsByCase.get(point.testCaseId) ?? []), point]);

  const caseItems = caseResponse.value ?? [];
  const caseIds = caseItems.map(item => {
    const tc = (item.workItem ?? item.testCase) as Record<string, unknown> | undefined;
    return Number(tc?.id ?? item.id ?? 0);
  }).filter(Boolean);
  const workItems = caseIds.length ? await request<AzureList<Record<string, unknown>>>(project, '/_apis/wit/workitems', {
    ids: caseIds.join(','), '$expand': 'Relations', 'api-version': '7.1',
  }) : { value: [] };
  const workItemsById = new Map((workItems.value ?? []).map(item => [Number(item.id), item]));
  const testCases = caseItems.map(item => {
    const tc = (item.workItem ?? item.testCase) as Record<string, unknown> | undefined;
    const id = Number(tc?.id ?? item.id ?? 0);
    const workItem = workItemsById.get(id);
    const fields = (workItem?.fields ?? {}) as Record<string, unknown>;
    const casePoints = pointsByCase.get(id) ?? [];
    const azureState = String(fields['System.State'] ?? '');
    const explicitActivePoint = casePoints.some(point => point.state.toLocaleLowerCase() === 'active');
    const currentPointWithoutState = casePoints.some(point => !point.state.trim());
    return { id, title: String(fields['System.Title'] ?? tc?.name ?? tc?.title ?? item.name ?? ''), order: Number(item.order ?? 0),
      azureState, description: plainText(fields['System.Description']),
      steps: parseManualSteps(fields['Microsoft.VSTS.TCM.Steps']), points: casePoints,
      active: explicitActivePoint || (currentPointWithoutState && !/^(closed|removed)$/i.test(azureState)) };
  });
  const configurations = (configurationResponse.value ?? []).map(config => ({
    id: Number(config.id), name: String(config.name ?? ''), values: config.values ?? [],
  })).sort((a, b) => a.name.localeCompare(b.name));
  const suite = allSuites.find(item => item.id === suiteId) ?? null;
  let requirement: { id:number; title:string; state:string; description:string; acceptanceCriteria:string } | null = null;
  if (suite?.requirementId) {
    const item = await request<Record<string, unknown>>(project, `/_apis/wit/workitems/${suite.requirementId}`, { 'api-version': '7.1' });
    const fields = (item.fields ?? {}) as Record<string, unknown>;
    requirement = { id: Number(item.id), title: String(fields['System.Title'] ?? ''), state: String(fields['System.State'] ?? ''),
      description: plainText(fields['System.Description']), acceptanceCriteria: plainText(fields['Microsoft.VSTS.Common.AcceptanceCriteria']) };
  }
  return { suite, requirement, testCases, points, configurations };
}

export async function publishDraftTestCase(project: string, planId: number, draft: {
  title: string; requirementId: number; caseType: string; preconditions: string; steps: string[];
  expectedResult: string; configurations: string[]; automationReason: string;
}, requirement: { title: string; iteration: string }) {
  const plan = (await listPlans(project)).find(item => item.id === planId);
  if (!plan?.rootSuiteId) throw new Error(`No se encontró el Test Plan ${planId} o su suite raíz.`);
  const [{ suites }, configurationResponse] = await Promise.all([
    ensureRequirementSuites(project, planId, plan.rootSuiteId, [{ id: draft.requirementId, title: requirement.title }]),
    request<AzureList<Record<string, unknown>>>(project, '/_apis/testplan/configurations', { 'api-version': '7.1', '$top': '1000' }),
  ]);
  const suite = suites[0];
  if (!suite) throw new Error(`No fue posible resolver la suite de la HU ${draft.requirementId}.`);
  const areaTree = await request<Record<string, unknown>>(project, '/_apis/wit/classificationnodes/Areas', { 'api-version': '7.1', '$depth': '10' });
  const areaPath = classificationPaths(project, areaTree).find(path => path.toLocaleLowerCase() === `${project}\\qa`.toLocaleLowerCase());
  if (!areaPath) throw new Error(`No existe el área ${project}\\QA.`);
  const patch = [
    azureField('System.Title', draft.title),
    azureField('System.IterationPath', requirement.iteration || plan.iteration),
    azureField('System.AreaPath', areaPath),
    azureField('Microsoft.VSTS.Common.Priority', 2),
    azureField('System.Description', `<p><strong>Precondiciones</strong></p><p>${escapeAzure(draft.preconditions)}</p><p><strong>HU origen</strong>: ${draft.requirementId}</p>`),
    azureField('Microsoft.VSTS.TCM.Steps', buildAzureSteps(draft.steps, draft.expectedResult)),
    azureField('System.Tags', `SGQA; HU-${draft.requirementId}; ${draft.caseType}`),
  ];
  const workItem = await request<Record<string, unknown>>(project, '/_apis/wit/workitems/$Test%20Case', { 'api-version': '7.1' }, {
    method: 'POST', body: patch, contentType: 'application/json-patch+json',
  });
  const configurations = new Map((configurationResponse.value ?? []).map(item => [String(item.name ?? '').toLocaleLowerCase(), Number(item.id)]));
  const pointAssignments = draft.configurations.map(name => configurations.get(name.toLocaleLowerCase())).filter((id): id is number => Boolean(id)).map(configurationId => ({ configurationId }));
  await request(project, `/_apis/testplan/Plans/${planId}/Suites/${suite.id}/TestCase`, { 'api-version': '7.1' }, {
    method: 'POST', body: [{ workItem: { id: Number(workItem.id) }, pointAssignments }],
  });
  return { testCaseId: Number(workItem.id), suiteId: suite.id, planId, pointAssignments: pointAssignments.length };
}

function azureField(path: string, value: unknown) { return { op: 'add', path: `/fields/${path}`, value }; }
function escapeAzure(value: string) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;'); }
function buildAzureSteps(steps: string[], finalExpected: string) {
  const body = steps.map((action, index) => {
    const expected = index === steps.length - 1 ? finalExpected : `La acción “${action}” se completa correctamente y permite continuar.`;
    return `<step id="${index + 1}" type="ActionStep"><parameterizedString isformatted="true">&lt;DIV&gt;${escapeAzure(action)}&lt;/DIV&gt;</parameterizedString><parameterizedString isformatted="true">&lt;DIV&gt;${escapeAzure(expected)}&lt;/DIV&gt;</parameterizedString><description/></step>`;
  }).join('');
  return `<steps id="0" last="${steps.length}">${body}</steps>`;
}
