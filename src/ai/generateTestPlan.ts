import { QaContext } from '../types/qaContext';
import { buildTestPlanPrompt } from './buildPrompt';
import { OpenAiProvider } from './providers/openai';
import { AiProvider } from './providers/aiProvider';

import {
  GeneratedTestPlan,
  generatedTestPlanSchema,
} from './testPlanSchema';
import { ZodError } from 'zod';

function getProvider(): AiProvider {
  const provider =
    process.env.AI_PROVIDER?.toLowerCase();

  switch (provider) {
    case 'openai':
      return new OpenAiProvider();

    default:
      throw new Error(
        `AI_PROVIDER no soportado: ${provider}`
      );
  }
}

export async function generateTestPlan(
  context: QaContext
): Promise<GeneratedTestPlan> {
  const prompt =
    buildTestPlanPrompt(context);

  const provider =
    getProvider();

  const rawResponse =
    await provider.generate(prompt);

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    console.error(
      '\nRespuesta recibida del modelo:\n'
    );

    console.error(rawResponse);

    throw new Error(
      'La IA no devolvió JSON válido'
    );
  }

  try {
    const plan = generatedTestPlanSchema.parse(parsed);

    if (plan.featureId !== context.feature.id) {
      throw new Error(
        `La IA devolvió featureId ${plan.featureId}; se esperaba ${context.feature.id}`
      );
    }

    if (plan.epicId !== context.epic.id) {
      throw new Error(
        `La IA devolvió epicId ${plan.epicId}; se esperaba ${context.epic.id}`
      );
    }

    if (plan.iterationPath !== context.feature.iterationPath) {
      throw new Error(
        `La IA devolvió iterationPath "${plan.iterationPath}"; ` +
        `se esperaba "${context.feature.iterationPath}"`
      );
    }

    const allowedConfigurationNames = new Set(
      context.availableConfigurations.map(
        configuration => configuration.name
      )
    );

    const allowedRequirementIds = new Set(
      context.userStories.map(story => story.id)
    );

    const allowedDesignReferences = new Set(
      context.designReferences.map(reference =>
        `${reference.fileKey}:${reference.nodeId ?? ''}`
      )
    );

    for (const suite of plan.suites) {
      if (!allowedRequirementIds.has(suite.sourceWorkItemId)) {
        throw new Error(
          `La suite "${suite.name}" referencia la HU/PBI ` +
          `${suite.sourceWorkItemId}, que no pertenece a la Feature`
        );
      }

      for (const name of suite.defaultConfigurationNames) {
        if (!allowedConfigurationNames.has(name)) {
          throw new Error(
            `La IA inventó una configuración no existente en Azure DevOps: ${name}`
          );
        }
      }

      for (const testCase of suite.testCases) {
        if (testCase.configurationAssignment.mode === 'selected') {
          for (const name of testCase.configurationAssignment.configurationNames) {
            if (!allowedConfigurationNames.has(name)) {
              throw new Error(
                `La IA inventó una configuración no existente en Azure DevOps: ${name}`
              );
            }
          }
        }

        for (const reference of testCase.designReferences) {
          const key = `${reference.fileKey}:${reference.nodeId ?? ''}`;

          if (!allowedDesignReferences.has(key)) {
            throw new Error(
              `La IA inventó una referencia Figma no presente en el contexto: ${key}`
            );
          }
        }
      }
    }

    return plan;
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues
        .map(issue => {
          const path = issue.path.length > 0
            ? issue.path.join('.')
            : '<root>';

          return `- ${path}: ${issue.message}`;
        })
        .join('\n');

      throw new Error(
        `La IA devolvió un Test Plan que no cumple el contrato:\n${details}`,
        { cause: error }
      );
    }

    throw error;
  }
}
