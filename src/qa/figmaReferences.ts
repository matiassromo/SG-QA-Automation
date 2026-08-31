import {
  QaDesignOrigin,
  QaDesignReference,
} from '../types/qaContext';

const FIGMA_URL_PATTERN =
  /https:\/\/(?:www\.)?figma\.com\/(?:design|file|proto)\/[A-Za-z0-9_-]+[^\s"'<>]*/gi;

interface FigmaReferenceSource {
  value?: unknown;
  origin: QaDesignOrigin;
  sourceWorkItemId?: number;
}

function parseFigmaUrl(
  rawUrl: string,
  source: Omit<FigmaReferenceSource, 'value'>
): QaDesignReference | null {
  const normalizedUrl = rawUrl
    .replace(/&amp;/gi, '&')
    .replace(/[),.;]+$/, '');

  try {
    const url = new URL(normalizedUrl);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const fileKey = pathParts[1];

    if (!fileKey) {
      return null;
    }

    const rawNodeId = url.searchParams.get('node-id');
    const nodeId = rawNodeId
      ? rawNodeId.replace(/-/g, ':')
      : undefined;

    return {
      provider: 'figma',
      url: url.toString(),
      fileKey,
      nodeId,
      origin: source.origin,
      sourceWorkItemId: source.sourceWorkItemId,
    };
  } catch {
    return null;
  }
}

export function extractFigmaReferences(
  sources: FigmaReferenceSource[]
): QaDesignReference[] {
  const references = sources.flatMap(source => {
    const text = typeof source.value === 'string'
      ? source.value
      : JSON.stringify(source.value ?? '');
    const matches = text.match(FIGMA_URL_PATTERN) ?? [];

    return matches
      .map(url => parseFigmaUrl(url, source))
      .filter(
        (reference): reference is QaDesignReference =>
          reference !== null
      );
  });

  return Array.from(
    new Map(
      references.map(reference => [
        `${reference.fileKey}:${reference.nodeId ?? ''}`,
        reference,
      ])
    ).values()
  );
}
