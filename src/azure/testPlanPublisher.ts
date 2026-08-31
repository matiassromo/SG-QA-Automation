import { GeneratedTestPlan } from '../ai/testPlanSchema';
import { PublicationTarget } from '../qa/publicationTarget';
import type { SuiteDryRunSummary } from '../qa/publicationDryRun';
import { getTestConfigurations } from './testConfigurations';
import { AzureRestTarget, azureRequest } from './restClient';
import {
  formatSequencedTestCaseTitle,
  getNextTestCaseSequence,
} from './testCaseSequence';

interface TestPlanResponse {
  id: number;
  name: string;
  rootSuite: { id: number; name: string };
}

interface TestSuiteResponse {
  id: number;
  name: string;
}

interface WorkItemResponse {
  id: number;
  fields?: Record<string, unknown>;
}

export interface PublishedSuite {
  id: number;
  name: string;
  requirementId: number;
  testCaseIds: number[];
  reusedTestCaseIds: number[];
}

export interface PublicationResult {
  organization: string;
  project: string;
  planId: number;
  planName: string;
  rootSuiteId: number;
  suites: PublishedSuite[];
}

export async function publishTestPlan(
  plan: GeneratedTestPlan,
  target: PublicationTarget,
  expectedNextSequence: number,
  dryRunSuites: SuiteDryRunSummary[],
  onProgress?: (result: PublicationResult) => Promise<void>
): Promise<PublicationResult> {
  const azureTarget: AzureRestTarget = target;
  const configurations = await getTestConfigurations(azureTarget);
  const configurationIds = new Map(
    configurations.map(configuration => [configuration.name, configuration.id])
  );
  const currentSequence = await getNextTestCaseSequence(
    azureTarget,
    target.testCaseNaming
  );
  if (currentSequence.next !== expectedNextSequence) {
    throw new Error(
      `La secuencia de Test Cases cambió después del dry-run: se esperaba ${expectedNextSequence} y ahora corresponde ${currentSequence.next}. Ejecute nuevamente el dry-run.`
    );
  }
  let nextSequence = currentSequence.next;

  const destination = target.existingPlanId
    ? await getExistingPlan(target.existingPlanId, azureTarget)
    : await createPlan(plan, target, azureTarget);

  const result: PublicationResult = {
    organization: target.organization,
    project: target.project,
    planId: destination.id,
    planName: destination.name,
    rootSuiteId: destination.rootSuite.id,
    suites: [],
  };
  await onProgress?.(result);

  const parentSuiteId = target.parentSuiteId ?? destination.rootSuite.id;

  for (const [suiteIndex, suite] of plan.suites.entries()) {
    const suiteDryRun = dryRunSuites[suiteIndex];
    const defaultConfigurationIds = suite.defaultConfigurationNames.map(name =>
      requireConfigurationId(configurationIds, name)
    );
    const createdSuite = await createRequirementSuite(
      destination.id,
      parentSuiteId,
      suite.name,
      suite.sourceWorkItemId,
      defaultConfigurationIds,
      target.defaultTesterIds,
      azureTarget
    );
    const publishedSuite: PublishedSuite = {
      id: createdSuite.id,
      name: createdSuite.name,
      requirementId: suite.sourceWorkItemId,
      testCaseIds: [],
      reusedTestCaseIds: [],
    };
    result.suites.push(publishedSuite);
    await onProgress?.(result);

    for (const [caseIndex, testCase] of suite.testCases.entries()) {
      const action = suiteDryRun.caseActions[caseIndex];
      const workItem = action.action === 'reuse'
        ? { id: action.existingTestCaseId! }
        : await createTestCaseWorkItem(
            testCase,
            plan,
            target,
            nextSequence,
            azureTarget
          );
      if (action.action === 'create') nextSequence += 1;
      const names = testCase.configurationAssignment.mode === 'inherit-suite'
        ? suite.defaultConfigurationNames
        : testCase.configurationAssignment.configurationNames;
      const pointAssignments = names.map(name => ({
        configurationId: requireConfigurationId(configurationIds, name),
      }));

      await azureRequest(
        action.action === 'reuse' ? 'PATCH' : 'POST',
        `/_apis/testplan/Plans/${destination.id}/Suites/${createdSuite.id}/TestCase`,
        {
          query: { 'api-version': '7.1' },
          target: azureTarget,
          body: [{ workItem: { id: workItem.id }, pointAssignments }],
        }
      );
      if (action.action === 'reuse') {
        publishedSuite.reusedTestCaseIds.push(workItem.id);
      } else {
        publishedSuite.testCaseIds.push(workItem.id);
      }
      await onProgress?.(result);
    }
  }

  return result;
}

async function createPlan(
  plan: GeneratedTestPlan,
  target: PublicationTarget,
  azureTarget: AzureRestTarget
) {
  const response = await azureRequest<TestPlanResponse>(
    'POST', '/_apis/testplan/plans', {
      query: { 'api-version': '7.1' },
      target: azureTarget,
      body: {
        name: target.testPlanName,
        iteration: target.iterationPath,
        areaPath: target.areaPath,
        state: 'Active',
        description: `${plan.objective}\n\nGenerado desde Feature ${plan.featureId}.`,
      },
    }
  );
  return response.data;
}

async function getExistingPlan(id: number, target: AzureRestTarget) {
  const response = await azureRequest<TestPlanResponse>(
    'GET', `/_apis/testplan/plans/${id}`, {
      query: { 'api-version': '7.1' }, target,
    }
  );
  return response.data;
}

async function createRequirementSuite(
  planId: number,
  parentSuiteId: number,
  name: string,
  requirementId: number,
  configurationIds: number[],
  defaultTesterIds: string[],
  target: AzureRestTarget
) {
  const response = await azureRequest<TestSuiteResponse>(
    'POST', `/_apis/testplan/Plans/${planId}/suites`, {
      query: { 'api-version': '7.1' },
      target,
      body: {
        suiteType: 'requirementTestSuite',
        name,
        requirementId,
        parentSuite: { id: parentSuiteId },
        inheritDefaultConfigurations: false,
        defaultConfigurations: configurationIds.map(id => ({ id })),
        defaultTesters: defaultTesterIds.map(id => ({ id })),
      },
    }
  );
  return response.data;
}

async function createTestCaseWorkItem(
  testCase: GeneratedTestPlan['suites'][number]['testCases'][number],
  plan: GeneratedTestPlan,
  target: PublicationTarget,
  sequence: number,
  azureTarget: AzureRestTarget
) {
  const description = [
    `<p><strong>Precondiciones</strong></p>`,
    `<ul>${testCase.preconditions.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`,
    `<p><strong>Fuentes</strong>: ${testCase.sourceWorkItemIds.join(', ')}</p>`,
    `<p><strong>Feature</strong>: ${plan.featureId}; <strong>Epic</strong>: ${plan.epicId}</p>`,
  ].join('');
  const patch = [
    field(
      'System.Title',
      formatSequencedTestCaseTitle(sequence, testCase.title, target.testCaseNaming)
    ),
    field('System.IterationPath', target.iterationPath),
    ...(target.areaPath ? [field('System.AreaPath', target.areaPath)] : []),
    field('Microsoft.VSTS.Common.Priority', testCase.priority),
    field('System.Description', description),
    field('Microsoft.VSTS.TCM.Steps', buildStepsXml(testCase.steps)),
    field('System.Tags', `SG-QA-Automation; Feature-${plan.featureId}; ${testCase.type}`),
  ];
  const response = await azureRequest<WorkItemResponse>(
    'POST', '/_apis/wit/workitems/$Test%20Case', {
      query: { 'api-version': '7.1' },
      target: azureTarget,
      body: patch,
      contentType: 'application/json-patch+json',
    }
  );
  return response.data;
}

function field(path: string, value: unknown) {
  return { op: 'add', path: `/fields/${path}`, value };
}

export function buildStepsXml(
  steps: GeneratedTestPlan['suites'][number]['testCases'][number]['steps']
) {
  const body = steps.map((step, index) =>
    `<step id="${index + 1}" type="ActionStep">` +
    `<parameterizedString isformatted="true">&lt;DIV&gt;${escapeXml(step.action)}&lt;/DIV&gt;</parameterizedString>` +
    `<parameterizedString isformatted="true">&lt;DIV&gt;${escapeXml(step.expected)}&lt;/DIV&gt;</parameterizedString>` +
    `<description/></step>`
  ).join('');
  return `<steps id="0" last="${steps.length}">${body}</steps>`;
}

function requireConfigurationId(configurations: Map<string, number>, name: string) {
  const id = configurations.get(name);
  if (!id) throw new Error(`No existe la configuración Azure "${name}"`);
  return id;
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeXml(value: string) {
  return escapeHtml(value).replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
