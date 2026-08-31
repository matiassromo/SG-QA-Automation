import { GeneratedTestPlan } from '../ai/testPlanSchema';
import { getTestConfigurations } from '../azure/testConfigurations';
import {
  ExistingTestPlanSummary,
  findTestPlansByName,
  validateRequirementWorkItems,
  validateClassificationPath,
  getTestPlanById,
  getTestSuitesForPlan,
  getLinkedTestCasesByRequirement,
  LinkedTestCase,
} from '../azure/testPlansRead';
import { PublicationTarget } from './publicationTarget';
import {
  getNextTestCaseSequence,
  parseSequencedTestCaseTitle,
} from '../azure/testCaseSequence';

export interface TestCaseDryRunAction {
  title: string;
  action: 'create' | 'reuse';
  existingTestCaseId?: number;
}

export interface SuiteDryRunSummary {
  name: string;
  requirementId: number;
  testCases: number;
  testPoints: number;
  configurationNames: string[];
  existingLinkedTestCases: LinkedTestCase[];
  newTestCases: number;
  reusedTestCases: number;
  expectedVisibleTestCases: number;
  caseActions: TestCaseDryRunAction[];
}

export interface PublicationDryRun {
  target: PublicationTarget;
  planName: string;
  featureId: number;
  iterationPath: string;
  suites: SuiteDryRunSummary[];
  totalTestCases: number;
  totalTestPoints: number;
  totalExistingLinkedTestCases: number;
  uniqueExistingLinkedTestCases: number;
  totalNewTestCases: number;
  totalReusedTestCases: number;
  expectedVisibleTestCases: number;
  testPointsAreMinimum: boolean;
  configurationCount: number;
  existingPlans: ExistingTestPlanSummary[];
  errors: string[];
  warnings: string[];
  testCaseSequence: {
    highestExisting: number;
    first: number;
    last: number;
    count: number;
  };
}

function getCaseConfigurationNames(
  suiteConfigurationNames: string[],
  assignment: GeneratedTestPlan['suites'][number]['testCases'][number]['configurationAssignment']
): string[] {
  return assignment.mode === 'inherit-suite'
    ? suiteConfigurationNames
    : assignment.configurationNames;
}

export async function createPublicationDryRun(
  plan: GeneratedTestPlan,
  target: PublicationTarget
): Promise<PublicationDryRun> {
  const azureTarget = {
    organization: target.organization,
    project: target.project,
  };
  const [availableConfigurations, existingPlans, requirementErrors, iterationError, areaError, sequence, linkedByRequirement] =
    await Promise.all([
      getTestConfigurations(azureTarget),
      findTestPlansByName(target.testPlanName, azureTarget),
      validateRequirementWorkItems(
        plan.suites.map(suite => suite.sourceWorkItemId),
        plan.featureId,
        azureTarget
      ),
      validateClassificationPath('Iterations', target.iterationPath, azureTarget),
      target.areaPath
        ? validateClassificationPath('Areas', target.areaPath, azureTarget)
        : Promise.resolve(null),
      getNextTestCaseSequence(azureTarget, target.testCaseNaming),
      getLinkedTestCasesByRequirement(
        plan.suites.map(suite => suite.sourceWorkItemId),
        azureTarget
      ),
    ]);

  const availableNames = new Set(
    availableConfigurations.map(configuration => configuration.name)
  );
  const errors = [...requirementErrors];
  if (iterationError) errors.push(iterationError);
  if (areaError) errors.push(areaError);
  const warnings: string[] = [];
  const usedConfigurations = new Set<string>();
  const seenTitles = new Set<string>();

  if (!target.existingPlanId && existingPlans.length > 0) {
    errors.push(
      `Ya existe ${existingPlans.length} Test Plan con el nombre "${target.testPlanName}"`
    );
  }

  if (target.existingPlanId) {
    try {
      const [existingPlan, existingSuites] = await Promise.all([
        getTestPlanById(target.existingPlanId, azureTarget),
        getTestSuitesForPlan(target.existingPlanId, azureTarget),
      ]);
      if (existingPlan.name.trim().toLocaleLowerCase() !== target.testPlanName.trim().toLocaleLowerCase()) {
        errors.push(`El Plan ID ${target.existingPlanId} se llama "${existingPlan.name}", no "${target.testPlanName}"`);
      }
      if (target.parentSuiteId && !existingSuites.some(suite => suite.id === target.parentSuiteId)) {
        errors.push(`La suite padre ${target.parentSuiteId} no pertenece al Plan ${target.existingPlanId}`);
      }
      const existingNames = new Set(existingSuites.map(suite => suite.name.trim().toLocaleLowerCase()));
      for (const suite of plan.suites) {
        if (existingNames.has(suite.name.trim().toLocaleLowerCase())) {
          errors.push(`Ya existe una suite llamada "${suite.name}" en el Plan ${target.existingPlanId}`);
        }
      }
    } catch (error) {
      errors.push(`No se pudo validar el Plan existente ${target.existingPlanId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const suites = plan.suites.map(suite => {
    let testPoints = 0;
    const existingLinkedTestCases =
      linkedByRequirement.get(suite.sourceWorkItemId) ?? [];
    const reusableByTitle = new Map<string, LinkedTestCase[]>();
    for (const existing of existingLinkedTestCases) {
      const key = normalizeTitle(existing.title, target);
      reusableByTitle.set(key, [...(reusableByTitle.get(key) ?? []), existing]);
    }
    const usedExistingIds = new Set<number>();
    const caseActions: TestCaseDryRunAction[] = [];

    if (existingLinkedTestCases.length > 0) {
      const detail = existingLinkedTestCases
        .map(item => `#${item.id} "${item.title}"`)
        .join('; ');
      if (target.existingTestCasePolicy === 'block') {
        errors.push(
          `La HU ${suite.sourceWorkItemId} ya tiene ${existingLinkedTestCases.length} Test Case(s) enlazado(s): ${detail}`
        );
      } else {
        warnings.push(
          `La HU ${suite.sourceWorkItemId} incorporará ${existingLinkedTestCases.length} Test Case(s) histórico(s): ${detail}`
        );
      }
    }

    for (const configurationName of suite.defaultConfigurationNames) {
      usedConfigurations.add(configurationName);

      if (!availableNames.has(configurationName)) {
        errors.push(
          `La configuración "${configurationName}" ya no existe en Azure DevOps`
        );
      }
    }

    for (const testCase of suite.testCases) {
      const normalizedTitle = testCase.title.trim().toLocaleLowerCase();

      if (seenTitles.has(normalizedTitle)) {
        warnings.push(
          `Título de Test Case duplicado dentro del preview: "${testCase.title}"`
        );
      }

      seenTitles.add(normalizedTitle);

      const configurationNames = getCaseConfigurationNames(
        suite.defaultConfigurationNames,
        testCase.configurationAssignment
      );

      for (const configurationName of configurationNames) {
        usedConfigurations.add(configurationName);

        if (!availableNames.has(configurationName)) {
          errors.push(
            `La configuración "${configurationName}" ya no existe en Azure DevOps`
          );
        }
      }

      testPoints += configurationNames.length;

      const candidates = reusableByTitle.get(
        normalizeTitle(testCase.title, target)
      ) ?? [];
      const reusable = target.existingTestCasePolicy === 'reuse'
        ? candidates.find(item => !usedExistingIds.has(item.id))
        : undefined;
      if (reusable) {
        usedExistingIds.add(reusable.id);
        caseActions.push({
          title: testCase.title,
          action: 'reuse',
          existingTestCaseId: reusable.id,
        });
      } else {
        caseActions.push({ title: testCase.title, action: 'create' });
      }
    }

    const reusedTestCases = caseActions.filter(item => item.action === 'reuse').length;
    const newTestCases = caseActions.length - reusedTestCases;

    return {
      name: suite.name,
      requirementId: suite.sourceWorkItemId,
      testCases: suite.testCases.length,
      testPoints,
      configurationNames: suite.defaultConfigurationNames,
      existingLinkedTestCases,
      newTestCases,
      reusedTestCases,
      expectedVisibleTestCases: existingLinkedTestCases.length + newTestCases,
      caseActions,
    };
  });

  const totalExistingLinkedTestCases = suites.reduce(
    (total, suite) => total + suite.existingLinkedTestCases.length, 0
  );
  const uniqueExistingLinkedTestCases = new Set(
    suites.flatMap(suite => suite.existingLinkedTestCases.map(item => item.id))
  ).size;
  const totalNewTestCases = suites.reduce(
    (total, suite) => total + suite.newTestCases, 0
  );
  const totalReusedTestCases = suites.reduce(
    (total, suite) => total + suite.reusedTestCases, 0
  );

  return {
    target,
    planName: target.testPlanName,
    featureId: plan.featureId,
    iterationPath: target.iterationPath,
    suites,
    totalTestCases: suites.reduce(
      (total, suite) => total + suite.testCases,
      0
    ),
    totalTestPoints: suites.reduce(
      (total, suite) => total + suite.testPoints,
      0
    ),
    totalExistingLinkedTestCases,
    uniqueExistingLinkedTestCases,
    totalNewTestCases,
    totalReusedTestCases,
    expectedVisibleTestCases: totalExistingLinkedTestCases + totalNewTestCases,
    testPointsAreMinimum:
      totalExistingLinkedTestCases > totalReusedTestCases,
    configurationCount: usedConfigurations.size,
    existingPlans,
    errors: Array.from(new Set(errors)),
    warnings: Array.from(new Set(warnings)),
    testCaseSequence: {
      highestExisting: sequence.highestExisting,
      first: sequence.next,
      last: sequence.next + totalNewTestCases - 1,
      count: totalNewTestCases,
    },
  };
}

function normalizeTitle(title: string, target: PublicationTarget) {
  const withoutSequence =
    parseSequencedTestCaseTitle(title, target.testCaseNaming)?.title ?? title;
  return withoutSequence
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
