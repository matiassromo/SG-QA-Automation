import { QaTestConfiguration } from '../types/qaContext';
import { AzureListResponse, AzureRestTarget, azureGet } from './restClient';

interface AzureTestConfiguration {
  id: number;
  name: string;
  isDefault?: boolean;
  values?: Array<{
    name?: string;
    value?: string;
  }>;
}

export async function getTestConfigurations(target?: AzureRestTarget): Promise<
  QaTestConfiguration[]
> {
  const configurations: QaTestConfiguration[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await azureGet<
      AzureListResponse<AzureTestConfiguration>
    >(
      '/_apis/testplan/configurations',
      {
        'api-version': '7.1',
        continuationToken,
      },
      target
    );

    configurations.push(
      ...response.data.value.map(configuration => ({
        id: configuration.id,
        name: configuration.name,
        isDefault: configuration.isDefault ?? false,
        values: (configuration.values ?? []).map(value => ({
          name: value.name ?? '',
          value: value.value ?? '',
        })),
      }))
    );

    continuationToken = response.continuationToken;
  } while (continuationToken);

  return configurations
    .filter(configuration => configuration.name.trim().length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));
}
