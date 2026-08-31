import { AzureRestTarget, azureRequest } from './restClient';

interface WiqlResponse {
  workItems?: Array<{ id: number }>;
}

interface WorkItemList {
  value: Array<{
    id: number;
    fields?: Record<string, unknown>;
  }>;
}

export interface TestCaseNaming {
  prefix: string;
  numberSeparator: string;
  padding: number;
  titleSeparator: string;
}

export interface TestCaseSequence {
  highestExisting: number;
  next: number;
}

export async function getNextTestCaseSequence(
  target: AzureRestTarget,
  naming: TestCaseNaming,
  excludedIds: ReadonlySet<number> = new Set()
): Promise<TestCaseSequence> {
  const wiql = await azureRequest<WiqlResponse>('POST', '/_apis/wit/wiql', {
    query: { 'api-version': '7.1' },
    target,
    body: {
      query:
        "SELECT [System.Id] FROM WorkItems " +
        "WHERE [System.TeamProject] = @project " +
        "AND [System.WorkItemType] = 'Test Case'",
    },
  });
  const ids = (wiql.data.workItems ?? []).map(item => item.id);
  let highestExisting = 0;

  for (let index = 0; index < ids.length; index += 200) {
    const batch = ids.slice(index, index + 200);
    if (batch.length === 0) continue;
    const response = await azureRequest<WorkItemList>(
      'GET', '/_apis/wit/workitems', {
        query: {
          ids: batch.join(','),
          fields: 'System.Title',
          'api-version': '7.1',
        },
        target,
      }
    );
    for (const workItem of response.data.value) {
      if (excludedIds.has(workItem.id)) continue;
      const title = String(workItem.fields?.['System.Title'] ?? '');
      const parsed = parseSequencedTestCaseTitle(title, naming);
      if (parsed) highestExisting = Math.max(highestExisting, parsed.sequence);
    }
  }

  return { highestExisting, next: highestExisting + 1 };
}

export function parseSequencedTestCaseTitle(
  title: string,
  naming: TestCaseNaming
): { sequence: number; title: string } | null {
  const match = buildSequencePatterns(naming)
    .map(pattern => pattern.exec(title))
    .find(Boolean);
  if (!match) return null;
  const titleStart = match[0].length;
  const remaining = title.slice(titleStart);
  const cleanTitle = remaining.replace(/^\s*(?:(?:\||-|:)\s*)?/, '');
  return { sequence: Number(match[1]), title: cleanTitle };
}

export function formatSequencedTestCaseTitle(
  sequence: number,
  title: string,
  naming: TestCaseNaming
) {
  return `${naming.prefix}${naming.numberSeparator}` +
    `${String(sequence).padStart(naming.padding, '0')}` +
    `${naming.titleSeparator}${title}`;
}

function buildSequencePatterns(naming: TestCaseNaming) {
  const prefix = escapeRegex(naming.prefix);
  const separator = flexibleWhitespaceRegex(naming.numberSeparator);
  const patterns = [new RegExp(`^${prefix}${separator}(\\d+)`, 'i')];
  if (naming.prefix.toLocaleUpperCase() === 'QA') {
    patterns.push(/^QA\s*-\s*(?:TC[-\s]*)?(\d+)/i);
  }
  return patterns;
}

function flexibleWhitespaceRegex(value: string) {
  return escapeRegex(value).replace(/\\ /g, '\\s*');
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
