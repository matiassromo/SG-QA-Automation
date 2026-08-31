import {
  QaDesignContext,
  QaDesignReference,
} from '../types/qaContext';
import { DesignProvider } from './providers/designProvider';
import { FigmaRestProvider } from './providers/figmaRest';

function getDesignProvider(): DesignProvider {
  const provider = (
    process.env.FIGMA_PROVIDER ?? 'rest'
  ).toLowerCase();

  if (provider !== 'rest') {
    throw new Error(
      `FIGMA_PROVIDER no soportado: ${provider}`
    );
  }

  const accessToken = process.env.FIGMA_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error(
      'Falta FIGMA_ACCESS_TOKEN en las variables de entorno'
    );
  }

  return new FigmaRestProvider(accessToken);
}

export async function buildDesignContexts(
  references: QaDesignReference[],
  options: { searchTerms?: string[] } = {}
): Promise<QaDesignContext[]> {
  const configuredProvider = (
    process.env.FIGMA_PROVIDER ?? 'disabled'
  ).toLowerCase();

  if (configuredProvider === 'disabled') {
    return [];
  }

  if (references.length === 0) {
    return [];
  }

  const provider = getDesignProvider();

  const contexts: QaDesignContext[] = [];

  for (const reference of references) {
    contexts.push(
      await provider.getContext(reference, options)
    );
  }

  return contexts;
}
