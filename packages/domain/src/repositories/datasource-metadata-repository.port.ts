import type { Datasource, DatasourceMetadata } from '../entities';

export abstract class IDatasourceMetadataRepository {
  public abstract getMetadata(
    datasource: Datasource,
  ): Promise<DatasourceMetadata>;
}
