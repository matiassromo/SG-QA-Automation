import dotenv from 'dotenv';

dotenv.config();

const pat = process.env.AZURE_DEVOPS_PAT;

if (!pat) {
  throw new Error(
    'Falta AZURE_DEVOPS_PAT para conectar con Azure DevOps'
  );
}

export interface AzureRestTarget {
  organization: string;
  project: string;
}

export interface AzureRestResponse<T> {
  data: T;
  continuationToken?: string;
}

export interface AzureListResponse<T> {
  count: number;
  value: T[];
}

export type AzureHttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export async function azureRequest<T>(
  method: AzureHttpMethod,
  path: string,
  options: {
    query?: Record<string, string | undefined>;
    target?: AzureRestTarget;
    body?: unknown;
    contentType?: string;
    service?: 'core' | 'test-results';
  } = {}
): Promise<AzureRestResponse<T>> {
  const target = options.target ?? getDefaultTarget();
  const host = options.service === 'test-results'
    ? 'https://vstmr.dev.azure.com'
    : 'https://dev.azure.com';
  const endpoint = new URL(
    `${host}/${encodeURIComponent(target.organization)}/` +
    `${encodeURIComponent(target.project)}${path}`
  );

  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) endpoint.searchParams.set(name, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  const authorization = Buffer.from(`:${pat}`).toString('base64');

  try {
    const response = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Basic ${authorization}`,
        Accept: 'application/json',
        ...(options.body === undefined ? {} : {
          'Content-Type': options.contentType ?? 'application/json',
        }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      throw new Error(
        `Azure DevOps rechazó ${method} ${path} (HTTP ${response.status}): ${detail}`
      );
    }

    const text = await response.text();
    return {
      data: (text ? JSON.parse(text) : undefined) as T,
      continuationToken:
        response.headers.get('x-ms-continuationtoken') ?? undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function azureGet<T>(
  path: string,
  query: Record<string, string | undefined> = {},
  target: AzureRestTarget = getDefaultTarget()
): Promise<AzureRestResponse<T>> {
  return azureRequest<T>('GET', path, { query, target });
}

function getDefaultTarget(): AzureRestTarget {
  const organization = process.env.AZURE_DEVOPS_ORG;
  const project = process.env.AZURE_DEVOPS_PROJECT;

  if (!organization || !project) {
    throw new Error('Faltan AZURE_DEVOPS_ORG o AZURE_DEVOPS_PROJECT');
  }

  return { organization, project };
}
