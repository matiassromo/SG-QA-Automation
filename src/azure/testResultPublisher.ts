import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { azureRequest, AzureListResponse, AzureRestTarget } from './restClient';

export type AzureTestOutcome = 'Passed' | 'Failed' | 'Blocked' | 'NotApplicable';

interface AzureTestPoint {
  id: number;
  testCase?: { id?: string; name?: string };
  testCaseReference?: { id?: number; name?: string };
  configuration?: { id?: string; name?: string };
}

interface AzureTestRun {
  id: number;
  name: string;
  state: string;
  webAccessUrl?: string;
}

interface AzureWorkItem {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
}

interface AzureTestCaseResult {
  id: number;
}

interface AzureTestAttachment {
  id: number;
  url: string;
}

interface AzureConnectionData {
  authenticatedUser?: { id?: string };
}

export interface PublishedTestStep {
  action: string;
  expected: string;
  outcome?: AzureTestOutcome;
}

export interface PublishTestResultInput {
  target: AzureRestTarget;
  planId: number;
  suiteId: number;
  testCaseId: number;
  configurationName: string;
  outcome: AzureTestOutcome;
  automatedTestName: string;
  priority?: number;
  steps?: PublishedTestStep[];
  ownerId?: string;
  azureRunMode?: 'planned' | 'automated';
  durationMs?: number;
  attachmentPaths?: string[];
  apply: boolean;
}

export interface PublishTestResultResult {
  applied: boolean;
  testPointId: number;
  configurationId?: number;
  runId?: number;
  testResultId?: number;
  attachmentIds?: number[];
  runName: string;
  outcome: AzureTestOutcome;
  webAccessUrl?: string;
}

export interface PublishSuiteCaseInput {
  testCaseId: number;
  configurationName?: string;
  outcome: AzureTestOutcome;
  automatedTestName: string;
  priority: number;
  steps: PublishedTestStep[];
  durationMs: number;
  attachmentPaths: string[];
  comment?: string;
}

export interface PublishTestSuiteInput {
  target: AzureRestTarget;
  planId: number;
  suiteId: number;
  suiteName: string;
  configurationName: string;
  cases: PublishSuiteCaseInput[];
  ownerId?: string;
  azureRunMode?: 'planned' | 'automated';
  apply: boolean;
}

export interface PublishedSuiteCaseResult {
  testCaseId: number;
  testPointId: number;
  testResultId?: number;
  outcome: AzureTestOutcome;
  attachmentIds: number[];
}

export interface PublishTestSuiteResult {
  applied: boolean;
  runId?: number;
  runName: string;
  webAccessUrl?: string;
  results: PublishedSuiteCaseResult[];
}

export async function publishTestSuiteResults(
  input: PublishTestSuiteInput
): Promise<PublishTestSuiteResult> {
  if (input.cases.length === 0) throw new Error('La suite no contiene resultados para publicar');

  const resolved = await Promise.all(input.cases.map(async testCase => {
    const point = await resolveTestPoint({
      ...testCase,
      target: input.target,
      planId: input.planId,
      suiteId: input.suiteId,
      configurationName: testCase.configurationName ?? input.configurationName,
      apply: input.apply,
    });
    const workItem = (await azureRequest<AzureWorkItem>(
      'GET',
      `/_apis/wit/workitems/${testCase.testCaseId}`,
      {
        target: input.target,
        query: {
          fields: 'System.Title,System.AssignedTo',
          'api-version': '7.1',
        },
      }
    )).data;
    return { testCase, point, workItem };
  }));

  const runName = `SG-QA-Automation | ${input.suiteName} | ${input.configurationName}`;
  if (!input.apply) {
    return {
      applied: false,
      runName,
      results: resolved.map(({ testCase, point }) => ({
        testCaseId: testCase.testCaseId,
        testPointId: point.id,
        outcome: testCase.outcome,
        attachmentIds: [],
      })),
    };
  }

  for (const item of resolved) {
    if (
      (item.testCase.outcome === 'Passed' || item.testCase.outcome === 'Failed') &&
      item.testCase.attachmentPaths.length === 0
    ) {
      throw new Error(`El Test Case ${item.testCase.testCaseId} no tiene video de evidencia`);
    }
  }

  const azureRunMode = input.azureRunMode ?? 'planned';
  const startedDate = new Date().toISOString();
  const firstAssignedTo = resolved
    .map(item => item.workItem.fields['System.AssignedTo'] as { id?: string } | undefined)
    .find(identity => identity?.id)?.id;
  const ownerId = input.ownerId
    ?? firstAssignedTo
    ?? await resolveAuthenticatedUserId(input.target);
  const run = (await azureRequest<AzureTestRun>('POST', '/_apis/test/runs', {
    target: input.target,
    query: { 'api-version': '7.1' },
    body: {
      name: runName,
      plan: { id: String(input.planId) },
      automated: azureRunMode === 'automated',
      state: 'InProgress',
      startedDate,
      comment: azureRunMode === 'planned'
        ? 'Suite procesada por SG-QA-Automation. Los casos ejecutados incluyen video; los no ejecutables se publican como Blocked con su motivo.'
        : 'Suite automatizada publicada por SG-QA-Automation.',
      ...(ownerId ? { owner: { id: ownerId } } : {}),
    },
  })).data;

  try {
    const completedDate = new Date().toISOString();
    const resultBodies = resolved.map(({ testCase, point, workItem }) => {
      const title = String(workItem.fields['System.Title'] ?? '').trim();
      if (!title) throw new Error(`El Test Case ${testCase.testCaseId} no tiene título`);
      const configurationId = point.configuration?.id;
      return {
        testCase: { id: String(testCase.testCaseId) },
        testCaseRevision: workItem.rev,
        testCaseTitle: title,
        testPoint: { id: String(point.id) },
        ...(configurationId ? { configuration: { id: configurationId } } : {}),
        outcome: testCase.outcome,
        state: 'Completed',
        priority: testCase.priority,
        startedDate,
        completedDate,
        automatedTestName: testCase.automatedTestName,
        automatedTestStorage: 'SG-QA-Automation',
        durationInMs: testCase.durationMs,
        ...(testCase.comment ? { comment: testCase.comment } : {}),
        ...(ownerId ? { runBy: { id: ownerId } } : {}),
        iterationDetails: buildIterationDetails({
          ...testCase,
          target: input.target,
          planId: input.planId,
          suiteId: input.suiteId,
          configurationName: testCase.configurationName ?? input.configurationName,
          apply: true,
        }, startedDate, completedDate, testCase.durationMs),
      };
    });

    const created = (await azureRequest<
      AzureListResponse<AzureTestCaseResult> | AzureTestCaseResult[]
    >('POST', `/_apis/test/runs/${run.id}/results`, {
      target: input.target,
      query: { 'api-version': '7.1' },
      body: resultBodies,
    })).data;
    const createdItems = Array.isArray(created) ? created : created.value;
    if (createdItems.length !== resolved.length) {
      throw new Error(`Azure creó ${createdItems.length} de ${resolved.length} resultados`);
    }

    if (azureRunMode === 'planned') {
      await azureRequest('PATCH', `/_apis/test/runs/${run.id}/results`, {
        target: input.target,
        query: { 'api-version': '7.1' },
        body: createdItems.map((createdItem, index) => ({
          id: createdItem.id,
          outcome: resolved[index].testCase.outcome,
          state: 'Completed',
          priority: resolved[index].testCase.priority,
          durationInMs: resolved[index].testCase.durationMs,
          ...(resolved[index].testCase.comment
            ? { comment: resolved[index].testCase.comment }
            : {}),
          ...(ownerId ? { runBy: { id: ownerId } } : {}),
          iterationDetails: resultBodies[index].iterationDetails,
        })),
      });
    }

    const publishedResults: PublishedSuiteCaseResult[] = [];
    for (const [index, item] of resolved.entries()) {
      const testResultId = createdItems[index].id;
      const attachmentIds: number[] = [];
      for (const attachmentPath of item.testCase.attachmentPaths) {
        attachmentIds.push(await uploadEvidence({
          target: input.target,
          runId: run.id,
          testResultId,
          attachmentPath,
          evidencePrefix: item.testCase.automatedTestName,
          configurationName: item.testCase.configurationName ?? input.configurationName,
          azureRunMode,
        }));
      }
      publishedResults.push({
        testCaseId: item.testCase.testCaseId,
        testPointId: item.point.id,
        testResultId,
        outcome: item.testCase.outcome,
        attachmentIds,
      });
    }

    const completedRun = (await updateRunState(input.target, run.id, 'Completed')).data;
    return {
      applied: true,
      runId: completedRun.id,
      runName,
      webAccessUrl: completedRun.webAccessUrl,
      results: publishedResults,
    };
  } catch (error) {
    await updateRunState(input.target, run.id, 'Aborted').catch(() => undefined);
    throw error;
  }
}

export async function publishTestResult(
  input: PublishTestResultInput
): Promise<PublishTestResultResult> {
  const point = await resolveTestPoint(input);
  const runName = `SG-QA-Automation | TC ${input.testCaseId} | ${input.configurationName}`;
  const configurationId = point.configuration?.id
    ? Number(point.configuration.id)
    : undefined;

  if (!input.apply) {
    return {
      applied: false,
      testPointId: point.id,
      configurationId,
      runName,
      outcome: input.outcome,
    };
  }

  const workItem = (await azureRequest<AzureWorkItem>(
    'GET',
    `/_apis/wit/workitems/${input.testCaseId}`,
    {
      target: input.target,
      query: {
        fields: 'System.Title,System.AssignedTo',
        'api-version': '7.1',
      },
    }
  )).data;
  const testCaseTitle = String(workItem.fields['System.Title'] ?? '').trim();
  if (!testCaseTitle) {
    throw new Error(`El Test Case ${input.testCaseId} no tiene System.Title`);
  }

  const now = new Date().toISOString();
  const assignedTo = workItem.fields['System.AssignedTo'] as
    | { id?: string }
    | undefined;
  const ownerId = input.ownerId
    ?? assignedTo?.id
    ?? await resolveAuthenticatedUserId(input.target);
  const azureRunMode = input.azureRunMode ?? 'planned';
  const run = (await azureRequest<AzureTestRun>(
    'POST',
    '/_apis/test/runs',
    {
      target: input.target,
      query: { 'api-version': '7.1' },
      body: {
        name: runName,
        plan: { id: String(input.planId) },
        automated: azureRunMode === 'automated',
        state: 'InProgress',
        startedDate: now,
        comment: azureRunMode === 'planned'
          ? 'Ejecución Playwright publicada como resultado planificado para conservar pasos y evidencias.'
          : 'Resultado automatizado publicado por SG-QA-Automation',
        ...(ownerId ? { owner: { id: ownerId } } : {}),
      },
    }
  )).data;

  try {
    const completedDate = new Date().toISOString();
    const durationInMs = input.durationMs ?? 0;
    const iterationDetails = buildIterationDetails(
      input,
      now,
      completedDate,
      durationInMs
    );
    const createdResults = (await azureRequest<
      AzureListResponse<AzureTestCaseResult> | AzureTestCaseResult[]
    >(
      'POST',
      `/_apis/test/runs/${run.id}/results`,
      {
        target: input.target,
        query: { 'api-version': '7.1' },
        body: [{
          testCase: { id: String(input.testCaseId) },
          testCaseRevision: workItem.rev,
          testCaseTitle,
          testPoint: { id: String(point.id) },
          ...(configurationId
            ? { configuration: { id: String(configurationId) } }
            : {}),
          outcome: input.outcome,
          state: 'Completed',
          priority: input.priority,
          startedDate: now,
          completedDate,
          automatedTestName: input.automatedTestName,
          automatedTestStorage: 'SG-QA-Automation',
          durationInMs,
          ...(ownerId ? { runBy: { id: ownerId } } : {}),
          iterationDetails,
        }],
      }
    )).data;
    const resultItems = Array.isArray(createdResults)
      ? createdResults
      : createdResults.value;
    const testResultId = resultItems[0]?.id;
    if (!testResultId) {
      throw new Error(`Azure no devolvió el ID del resultado para el Run ${run.id}`);
    }

    if (azureRunMode === 'planned') {
      await azureRequest(
        'PATCH',
        `/_apis/test/runs/${run.id}/results`,
        {
          target: input.target,
          query: { 'api-version': '7.1' },
          body: [{
            id: testResultId,
            outcome: input.outcome,
            state: 'Completed',
            priority: input.priority,
            durationInMs,
            ...(ownerId ? { runBy: { id: ownerId } } : {}),
            iterationDetails,
          }],
        }
      );
    }

    const attachmentIds: number[] = [];
    for (const attachmentPath of input.attachmentPaths ?? []) {
      const absolutePath = path.resolve(attachmentPath);
      const extension = path.extname(absolutePath);
      const evidenceName = [input.automatedTestName, input.configurationName]
        .join('-')
        .replace(/[^a-zA-Z0-9._-]/g, '-') + extension;
      const iterationAttachment = azureRunMode === 'planned';
      const attachment = (await azureRequest<AzureTestAttachment>(
        'POST',
        iterationAttachment
          ? `/_apis/testresults/runs/${run.id}/results/${testResultId}/attachments`
          : `/_apis/test/Runs/${run.id}/Results/${testResultId}/attachments`,
        {
          target: input.target,
          service: iterationAttachment ? 'test-results' : 'core',
          query: iterationAttachment
            ? { iterationId: '1', 'api-version': '7.1-preview.1' }
            : { 'api-version': '7.1' },
          body: {
            stream: (await readFile(absolutePath)).toString('base64'),
            fileName: evidenceName,
            comment: 'Evidencia generada automáticamente por Playwright',
            attachmentType: 'GeneralAttachment',
          },
        }
      )).data;
      attachmentIds.push(attachment.id);
    }

    const completedRun = (await updateRunState(input.target, run.id, 'Completed')).data;

    return {
      applied: true,
      testPointId: point.id,
      configurationId,
      runId: completedRun.id,
      testResultId,
      attachmentIds,
      runName,
      outcome: input.outcome,
      webAccessUrl: completedRun.webAccessUrl,
    };
  } catch (error) {
    await updateRunState(input.target, run.id, 'Aborted').catch(() => undefined);
    throw error;
  }
}

function buildIterationDetails(
  input: PublishTestResultInput,
  startedDate: string,
  completedDate: string,
  durationInMs: number
) {
  return [{
    id: 1,
    outcome: input.outcome,
    startedDate,
    completedDate,
    durationInMs,
    actionResults: (input.steps ?? []).map((step, index) => ({
      actionPath: String(index + 1).padStart(8, '0'),
      iterationId: 1,
      stepIdentifier: String(index + 1),
      outcome: step.outcome ?? input.outcome,
      startedDate,
      completedDate,
    })),
  }];
}

async function uploadEvidence(input: {
  target: AzureRestTarget;
  runId: number;
  testResultId: number;
  attachmentPath: string;
  evidencePrefix: string;
  configurationName: string;
  azureRunMode: 'planned' | 'automated';
}) {
  const absolutePath = path.resolve(input.attachmentPath);
  const extension = path.extname(absolutePath);
  const evidenceName = [input.evidencePrefix, input.configurationName]
    .join('-')
    .replace(/[^a-zA-Z0-9._-]/g, '-') + extension;
  const iterationAttachment = input.azureRunMode === 'planned';
  const attachment = (await azureRequest<AzureTestAttachment>(
    'POST',
    iterationAttachment
      ? `/_apis/testresults/runs/${input.runId}/results/${input.testResultId}/attachments`
      : `/_apis/test/Runs/${input.runId}/Results/${input.testResultId}/attachments`,
    {
      target: input.target,
      service: iterationAttachment ? 'test-results' : 'core',
      query: iterationAttachment
        ? { iterationId: '1', 'api-version': '7.1-preview.1' }
        : { 'api-version': '7.1' },
      body: {
        stream: (await readFile(absolutePath)).toString('base64'),
        fileName: evidenceName,
        comment: 'Evidencia generada automáticamente por Playwright',
        attachmentType: 'GeneralAttachment',
      },
    }
  )).data;
  return attachment.id;
}

async function resolveAuthenticatedUserId(target: AzureRestTarget) {
  try {
    const response = await azureRequest<AzureConnectionData>(
      'GET',
      '/_apis/connectionData',
      {
        target,
        query: {
          connectOptions: '1',
          lastChangeId: '-1',
          lastChangeId64: '-1',
          'api-version': '7.1-preview.1',
        },
      }
    );
    return response.data.authenticatedUser?.id;
  } catch {
    return undefined;
  }
}

export function updateRunState(
  target: AzureRestTarget,
  runId: number,
  state: 'Completed' | 'Aborted'
) {
  return azureRequest<AzureTestRun>(
    'PATCH',
    `/_apis/test/runs/${runId}`,
    {
      target,
      query: { 'api-version': '7.1' },
      body: {
        state,
        completedDate: new Date().toISOString(),
        ...(state === 'Aborted'
          ? { comment: 'Run parcial cerrado por SG-QA-Automation' }
          : {}),
      },
    }
  );
}

async function resolveTestPoint(input: PublishTestResultInput) {
  const response = await azureRequest<AzureListResponse<AzureTestPoint>>(
    'GET',
    `/_apis/testplan/Plans/${input.planId}/Suites/${input.suiteId}/TestPoint`,
    {
      target: input.target,
      query: {
        testCaseId: String(input.testCaseId),
        'api-version': '7.1',
      },
    }
  );

  const points = response.data.value.filter(point =>
    Number(point.testCaseReference?.id ?? point.testCase?.id ?? input.testCaseId) === input.testCaseId
  );
  const normalizedName = input.configurationName.trim().toLocaleLowerCase();
  const point = points.find(candidate =>
    candidate.configuration?.name?.trim().toLocaleLowerCase() === normalizedName
  );

  if (!point) {
    const available = points
      .map(candidate => candidate.configuration?.name ?? `point-${candidate.id}`)
      .join(', ');
    throw new Error(
      `No existe un Test Point para Test Case ${input.testCaseId} con configuración ` +
      `"${input.configurationName}" en Plan ${input.planId}/Suite ${input.suiteId}. ` +
      `Disponibles: ${available || 'ninguno'}`
    );
  }

  return point;
}
