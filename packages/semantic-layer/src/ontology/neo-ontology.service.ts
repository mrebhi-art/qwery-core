import { getLogger } from '@qwery/shared/logger';

import { generateEmbedding, datasetEmbeddingText, EMBEDDING_DIMENSIONS } from '../embedding';
import { getNeo4jDriver } from '../neo4j';
import type { OSIDataset, OSIRelationship, OSISemanticModel } from '../osi/types';

export interface DatasetResult {
  name: string;
  label: string;
  source: string;
  description: string;
}

export interface DatasetSearchResult extends DatasetResult {
  score: number;
  fields: string; // JSON string
}

export interface GraphStats {
  nodeCount: number;
  relationshipCount: number;
  datasetCount: number;
}

export class NeoOntologyService {
  async createGraph(datasourceId: string, model: OSISemanticModel): Promise<GraphStats> {
    const logger = await getLogger();
    const def = model.semantic_model[0];
    if (!def) throw new Error('Empty semantic model');

    const driver = getNeo4jDriver();
    const session = driver.session();

    try {
      // 1. Clear existing graph for this datasource
      await session.run(
        'MATCH (n {ontologyId: $ontologyId}) DETACH DELETE n',
        { ontologyId: datasourceId },
      );

      // 2. Create Dataset nodes
      await session.executeWrite(async (tx) => {
        for (const dataset of def.datasets) {
          await tx.run(
            `CREATE (d:Dataset {
              id: $id,
              ontologyId: $ontologyId,
              name: $name,
              label: $label,
              source: $source,
              description: $description,
              fields: $fields
            })`,
            {
              id: dataset.name,
              ontologyId: datasourceId,
              name: dataset.name,
              label: dataset.label ?? dataset.name,
              source: dataset.source,
              description: dataset.description ?? '',
              fields: JSON.stringify(dataset.fields ?? []),
            },
          );
        }
      });

      // 3. Create Field nodes and HAS_FIELD edges
      await session.executeWrite(async (tx) => {
        for (const dataset of def.datasets) {
          for (const field of dataset.fields ?? []) {
            const aiCtx = field.ai_context && typeof field.ai_context === 'object'
              ? (field.ai_context as Record<string, unknown>)
              : {};

            await tx.run(
              `MATCH (d:Dataset {id: $datasetId, ontologyId: $ontologyId})
               CREATE (f:Field {
                 name: $name,
                 ontologyId: $ontologyId,
                 datasetId: $datasetId,
                 label: $label,
                 description: $description,
                 dataType: $dataType,
                 isPrimaryKey: $isPrimaryKey,
                 isTime: $isTime
               })
               CREATE (d)-[:HAS_FIELD]->(f)`,
              {
                datasetId: dataset.name,
                ontologyId: datasourceId,
                name: field.name,
                label: field.label ?? field.name,
                description: field.description ?? '',
                dataType: String(aiCtx['data_type'] ?? ''),
                isPrimaryKey: Boolean(aiCtx['is_primary_key'] ?? false),
                isTime: field.dimension?.is_time ?? false,
              },
            );
          }
        }
      });

      // 4. Create RELATES_TO edges
      await session.executeWrite(async (tx) => {
        for (const rel of def.relationships ?? []) {
          await tx.run(
            `MATCH (from:Dataset {id: $from, ontologyId: $ontologyId})
             MATCH (to:Dataset {id: $to, ontologyId: $ontologyId})
             CREATE (from)-[:RELATES_TO {
               name: $name,
               ontologyId: $ontologyId,
               fromColumns: $fromColumns,
               toColumns: $toColumns
             }]->(to)`,
            {
              from: rel.from,
              to: rel.to,
              ontologyId: datasourceId,
              name: rel.name,
              fromColumns: JSON.stringify(rel.from_columns),
              toColumns: JSON.stringify(rel.to_columns),
            },
          );
        }
      });

      // 5. Ensure vector index exists
      await session.run(
        `CREATE VECTOR INDEX dataset_embedding IF NOT EXISTS
         FOR (n:Dataset) ON (n.embedding)
         OPTIONS {
           indexConfig: {
             \`vector.dimensions\`: ${EMBEDDING_DIMENSIONS},
             \`vector.similarity_function\`: 'cosine'
           }
         }`,
      );

      // 6. Generate and store embeddings
      logger.info({ datasourceId, datasets: def.datasets.length }, 'semantic-layer: generating embeddings');
      for (const dataset of def.datasets) {
        const text = datasetEmbeddingText(dataset);
        const embedding = await generateEmbedding(text);

        await session.run(
          `MATCH (d:Dataset {id: $id, ontologyId: $ontologyId})
           CALL db.create.setNodeVectorProperty(d, 'embedding', $embedding)`,
          { id: dataset.name, ontologyId: datasourceId, embedding },
        );
      }

      // Count results
      const statsResult = await session.run(
        `MATCH (n {ontologyId: $ontologyId})
         RETURN
           count(n) AS nodeCount,
           count(CASE WHEN n:Dataset THEN 1 END) AS datasetCount`,
        { ontologyId: datasourceId },
      );

      const relResult = await session.run(
        `MATCH ()-[r {ontologyId: $ontologyId}]->()
         RETURN count(r) AS relationshipCount`,
        { ontologyId: datasourceId },
      );

      const stats = statsResult.records[0];
      const relStats = relResult.records[0];

      return {
        nodeCount: stats?.get('nodeCount').toNumber() ?? 0,
        datasetCount: stats?.get('datasetCount').toNumber() ?? 0,
        relationshipCount: relStats?.get('relationshipCount').toNumber() ?? 0,
      };
    } finally {
      await session.close();
    }
  }

  async listDatasets(datasourceId: string): Promise<DatasetResult[]> {
    const driver = getNeo4jDriver();
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH (d:Dataset {ontologyId: $ontologyId})
         RETURN d.name AS name, d.label AS label, d.source AS source, d.description AS description`,
        { ontologyId: datasourceId },
      );
      return result.records.map((r) => ({
        name: r.get('name'),
        label: r.get('label'),
        source: r.get('source'),
        description: r.get('description'),
      }));
    } finally {
      await session.close();
    }
  }

  async getDatasetDetails(datasourceId: string, datasetNames: string[]): Promise<(DatasetResult & { fields: string })[]> {
    const driver = getNeo4jDriver();
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH (d:Dataset {ontologyId: $ontologyId})
         WHERE d.name IN $names
         RETURN d.name AS name, d.label AS label, d.source AS source,
                d.description AS description, d.fields AS fields`,
        { ontologyId: datasourceId, names: datasetNames },
      );
      return result.records.map((r) => ({
        name: r.get('name'),
        label: r.get('label'),
        source: r.get('source'),
        description: r.get('description'),
        fields: r.get('fields'),
      }));
    } finally {
      await session.close();
    }
  }

  async getRelationships(datasourceId: string): Promise<Array<{
    fromDataset: string;
    toDataset: string;
    name: string;
    fromColumns: string[];
    toColumns: string[];
  }>> {
    const driver = getNeo4jDriver();
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH (from:Dataset {ontologyId: $ontologyId})-[r:RELATES_TO]->(to:Dataset)
         RETURN from.name AS fromDataset, to.name AS toDataset,
                r.name AS name, r.fromColumns AS fromColumns, r.toColumns AS toColumns`,
        { ontologyId: datasourceId },
      );
      return result.records.map((r) => ({
        fromDataset: r.get('fromDataset'),
        toDataset: r.get('toDataset'),
        name: r.get('name'),
        fromColumns: JSON.parse(r.get('fromColumns')),
        toColumns: JSON.parse(r.get('toColumns')),
      }));
    } finally {
      await session.close();
    }
  }

  async searchSimilar(datasourceId: string, query: string, topK = 5): Promise<DatasetSearchResult[]> {
    const embedding = await generateEmbedding(query);
    const driver = getNeo4jDriver();
    const session = driver.session();
    try {
      const limit = Math.floor(topK) * 8;
      const top = Math.floor(topK);
      const result = await session.run(
        `CALL db.index.vector.queryNodes('dataset_embedding', ${limit}, $embedding)
         YIELD node, score
         WHERE node.ontologyId = $ontologyId
         RETURN node.name AS name, node.label AS label, node.source AS source,
                node.description AS description, node.fields AS fields, score
         LIMIT ${top}`,
        { ontologyId: datasourceId, embedding },
      );
      return result.records.map((r) => ({
        name: r.get('name'),
        label: r.get('label'),
        source: r.get('source'),
        description: r.get('description'),
        fields: r.get('fields'),
        score: r.get('score'),
      }));
    } finally {
      await session.close();
    }
  }

  async deleteGraph(datasourceId: string): Promise<void> {
    const driver = getNeo4jDriver();
    const session = driver.session();
    try {
      await session.run(
        'MATCH (n {ontologyId: $ontologyId}) DETACH DELETE n',
        { ontologyId: datasourceId },
      );
    } finally {
      await session.close();
    }
  }
}

export const neoOntologyService = new NeoOntologyService();
