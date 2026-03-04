import { describe, expect, it } from 'vitest';
import type { DatasourceMetadata } from '../../../src/entities';
import { TransformMetadataToCompactSchemaService } from '../../../src/services/datasources/transform-metadata-to-compact-schema.service';

describe('TransformMetadataToCompactSchemaService', () => {
  const service = new TransformMetadataToCompactSchemaService();

  const metadata: DatasourceMetadata = {
    version: '0.0.1',
    driver: 'duckdb',
    schemas: [{ id: 1, name: 'public', owner: 'unknown' }],
    tables: [
      {
        id: 10,
        schema: 'public',
        name: 'orders',
        rls_enabled: false,
        rls_forced: false,
        bytes: 100,
        size: '100 bytes',
        live_rows_estimate: 20,
        dead_rows_estimate: 0,
        comment: 'orders table',
        primary_keys: [
          {
            table_id: 10,
            name: 'id',
            schema: 'public',
            table_name: 'orders',
          },
        ],
        relationships: [
          {
            id: 1,
            constraint_name: 'orders_customer_id_fkey',
            source_schema: 'public',
            source_table_name: 'orders',
            source_column_name: 'customer_id',
            target_table_schema: 'public',
            target_table_name: 'customers',
            target_column_name: 'id',
          },
        ],
      },
    ],
    columns: [
      {
        id: 'public.orders.customer_id',
        table_id: 10,
        schema: 'public',
        table: 'orders',
        name: 'customer_id',
        ordinal_position: 2,
        data_type: 'INTEGER',
        format: 'INTEGER',
        is_identity: false,
        identity_generation: null,
        is_generated: false,
        is_nullable: false,
        is_updatable: true,
        is_unique: false,
        check: null,
        default_value: null,
        enums: [],
        comment: null,
      },
      {
        id: 'public.orders.id',
        table_id: 10,
        schema: 'public',
        table: 'orders',
        name: 'id',
        ordinal_position: 1,
        data_type: 'INTEGER',
        format: 'INTEGER',
        is_identity: true,
        identity_generation: 'BY DEFAULT',
        is_generated: false,
        is_nullable: false,
        is_updatable: false,
        is_unique: true,
        check: null,
        default_value: null,
        enums: [],
        comment: null,
      },
    ],
    indexes: [
      {
        id: 90,
        table_id: 10,
        schema: 'public',
        is_unique: true,
        is_primary: true,
        index_definition: 'CREATE INDEX idx_orders_id ON orders(id)',
        access_method: 'btree',
        comment: null,
      },
    ],
  };

  it('keeps only compact fields with optional keys by default', async () => {
    const result = await service.execute({ metadata });
    expect(result).toEqual({
      schemas: [
        {
          name: 'public',
          tables: [
            {
              name: 'orders',
              columns: [
                { name: 'id', type: 'INTEGER' },
                { name: 'customer_id', type: 'INTEGER' },
              ],
              primaryKeys: ['id'],
              foreignKeys: [
                {
                  columnName: 'customer_id',
                  references: {
                    schemaName: 'public',
                    tableName: 'customers',
                    columnName: 'id',
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('can omit key metadata when disabled', async () => {
    const result = await service.execute({
      metadata,
      includePrimaryKeys: false,
      includeForeignKeys: false,
    });

    expect(result.schemas[0]?.tables[0]).toEqual({
      name: 'orders',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'customer_id', type: 'INTEGER' },
      ],
    });
  });
});
