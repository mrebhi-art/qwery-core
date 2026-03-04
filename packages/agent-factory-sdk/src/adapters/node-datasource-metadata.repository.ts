import type { Datasource, DatasourceMetadata } from '@qwery/domain/entities';
import type { IDatasourceMetadataRepository } from '@qwery/domain/repositories';
import {
  ExtensionsRegistry,
  type DatasourceExtension,
} from '@qwery/extensions-sdk';
import { getDriverInstance } from '@qwery/extensions-loader';

export class NodeDatasourceMetadataRepository
  implements IDatasourceMetadataRepository
{
  async getMetadata(datasource: Datasource): Promise<DatasourceMetadata> {
    const extension = ExtensionsRegistry.get(datasource.datasource_provider) as
      | DatasourceExtension
      | undefined;
    if (!extension?.drivers?.length) {
      throw new Error(
        `No driver found for provider: ${datasource.datasource_provider}`,
      );
    }

    const nodeDriver =
      extension.drivers.find((driver) => driver.runtime === 'node') ??
      extension.drivers[0];
    if (!nodeDriver) {
      throw new Error(
        `No node driver for provider: ${datasource.datasource_provider}`,
      );
    }

    const instance = await getDriverInstance(nodeDriver, {
      config: datasource.config,
    });

    try {
      return await instance.metadata();
    } finally {
      if (typeof instance.close === 'function') {
        await instance.close();
      }
    }
  }
}
