import path from 'node:path';

import { GeneratedTestPlan } from '../ai/testPlanSchema';
import {
  AutomationManifest,
  automationManifestSchema,
} from './automationManifestSchema';

interface PublicationJournal {
  organization: string;
  project: string;
  planId: number;
  planName: string;
  suites: Array<{
    requirementId: number;
    testCaseIds: number[];
    reusedTestCaseIds?: number[];
  }>;
}

export function buildAutomationManifest(
  plan: GeneratedTestPlan,
  journal: PublicationJournal,
  sourcePreview: string,
  sourceJournal: string
): AutomationManifest {
  const cases: AutomationManifest['cases'] = [];
  let totalTestCases = 0;

  for (const [suiteIndex, suite] of plan.suites.entries()) {
    totalTestCases += suite.testCases.length;
    const journalSuite = journal.suites[suiteIndex];
    if (!journalSuite || journalSuite.requirementId !== suite.sourceWorkItemId) {
      throw new Error(
        `El journal no coincide con la suite de la HU ${suite.sourceWorkItemId}`
      );
    }
    const ids = resolveOrderedIds(journalSuite, suite.testCases.length);

    for (const [caseIndex, testCase] of suite.testCases.entries()) {
      if (!testCase.automationCandidate) continue;
      const configurationNames = testCase.configurationAssignment.mode ===
        'inherit-suite'
        ? suite.defaultConfigurationNames
        : testCase.configurationAssignment.configurationNames;
      const executionTargets = configurationNames.map(classifyConfiguration);
      const playwrightEligible = executionTargets.some(
        target => target.runner === 'playwright-web'
      );

      cases.push({
        azureTestCaseId: ids[caseIndex],
        requirementId: suite.sourceWorkItemId,
        suiteName: suite.name,
        title: testCase.title,
        priority: testCase.priority,
        type: testCase.type,
        preconditions: testCase.preconditions,
        steps: testCase.steps,
        executionTargets,
        playwrightEligible,
        selectorDiscoveryRequired: true,
        status: playwrightEligible
          ? 'ready-for-scaffold'
          : 'runner-definition-required',
      });
    }
  }

  return automationManifestSchema.parse({
    generatedAt: new Date().toISOString(),
    featureId: plan.featureId,
    planId: journal.planId,
    planName: journal.planName,
    organization: journal.organization,
    project: journal.project,
    sourcePreview: path.resolve(sourcePreview),
    sourceJournal: path.resolve(sourceJournal),
    summary: {
      totalTestCases,
      automationCandidates: cases.length,
      playwrightEligible: cases.filter(item => item.playwrightEligible).length,
      runnerDefinitionRequired: cases.filter(item => !item.playwrightEligible).length,
    },
    cases,
  });
}

function resolveOrderedIds(
  suite: PublicationJournal['suites'][number],
  expectedCount: number
) {
  const created = suite.testCaseIds ?? [];
  const reused = suite.reusedTestCaseIds ?? [];
  if (created.length === expectedCount && reused.length === 0) return created;
  if (reused.length === expectedCount && created.length === 0) return reused;
  throw new Error(
    'El journal mezcla casos creados y reutilizados sin conservar su orden. ' +
    'Genere un journal con caseActions antes de crear el manifiesto.'
  );
}

function classifyConfiguration(configurationName: string) {
  const normalized = configurationName.trim().toLocaleLowerCase();
  if (['chrome', 'firefox', 'microsoft edge', 'macos - safari'].includes(normalized)) {
    return {
      configurationName,
      runner: 'playwright-web' as const,
      supportedNow: true,
      note: 'Automatizable como navegador web con Playwright.',
    };
  }
  if (normalized === 'android' || normalized === 'ios') {
    return {
      configurationName,
      runner: 'mobile-runner-required' as const,
      supportedNow: false,
      note: 'Definir si es mobile web o aplicación nativa; una app nativa requiere Appium u otro runner móvil.',
    };
  }
  return {
    configurationName,
    runner: 'browser-definition-required' as const,
    supportedNow: false,
    note: 'La configuración no identifica un navegador; debe mapearse a un proyecto Playwright concreto.',
  };
}
