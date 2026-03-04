import type {
  CompactDatasourceSchema,
  CompactSchemaEntry,
  CompactSchemaTable,
} from '../../entities';
import type {
  TransformMetadataToCompactSchemaInput,
  TransformMetadataToCompactSchemaUseCase,
} from '../../usecases';

export class TransformMetadataToCompactSchemaService
  implements TransformMetadataToCompactSchemaUseCase
{
  public async execute(
    input: TransformMetadataToCompactSchemaInput,
  ): Promise<CompactDatasourceSchema> {
    const {
      metadata,
      includePrimaryKeys = true,
      includeForeignKeys = true,
    } = input;

    const tablesBySchema = new Map<string, CompactSchemaTable[]>();
    const columnsByTableKey = new Map<
      string,
      Array<{ name: string; type: string; ordinalPosition: number }>
    >();

    for (const column of metadata.columns) {
      const tableKey = `${column.schema}.${column.table}`;
      const existing = columnsByTableKey.get(tableKey);
      const compactColumn = {
        name: column.name,
        type: column.data_type,
        ordinalPosition: column.ordinal_position,
      };

      if (existing) {
        existing.push(compactColumn);
      } else {
        columnsByTableKey.set(tableKey, [compactColumn]);
      }
    }

    for (const table of metadata.tables) {
      const schemaName = table.schema || 'main';
      const tableKey = `${schemaName}.${table.name}`;
      const compactColumns = (columnsByTableKey.get(tableKey) ?? [])
        .sort((a, b) => a.ordinalPosition - b.ordinalPosition)
        .map((column) => ({
          name: column.name,
          type: column.type,
        }));

      const compactTable: CompactSchemaTable = {
        name: table.name,
        columns: compactColumns,
      };

      if (includePrimaryKeys) {
        const primaryKeys = table.primary_keys.map((key) => key.name);
        if (primaryKeys.length > 0) {
          compactTable.primaryKeys = primaryKeys;
        }
      }

      if (includeForeignKeys) {
        const foreignKeys = table.relationships.map((relationship) => ({
          columnName: relationship.source_column_name,
          references: {
            schemaName: relationship.target_table_schema,
            tableName: relationship.target_table_name,
            columnName: relationship.target_column_name,
          },
        }));

        if (foreignKeys.length > 0) {
          compactTable.foreignKeys = foreignKeys;
        }
      }

      const schemaTables = tablesBySchema.get(schemaName);
      if (schemaTables) {
        schemaTables.push(compactTable);
      } else {
        tablesBySchema.set(schemaName, [compactTable]);
      }
    }

    const schemas: CompactSchemaEntry[] = Array.from(tablesBySchema.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, tables]) => ({
        name,
        tables,
      }));

    return { schemas };
  }
}
