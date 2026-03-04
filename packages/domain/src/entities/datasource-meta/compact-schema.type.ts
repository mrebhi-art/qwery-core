export interface CompactSchemaColumn {
  name: string;
  type: string;
}

export interface CompactSchemaForeignKey {
  columnName: string;
  references: {
    schemaName: string;
    tableName: string;
    columnName: string;
  };
}

export interface CompactSchemaTable {
  name: string;
  columns: CompactSchemaColumn[];
  primaryKeys?: string[];
  foreignKeys?: CompactSchemaForeignKey[];
}

export interface CompactSchemaEntry {
  name: string;
  tables: CompactSchemaTable[];
}

export interface CompactDatasourceSchema {
  schemas: CompactSchemaEntry[];
}
