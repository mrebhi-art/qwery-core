import { prepareBirdDatasource } from './single-turn/bird-datasource';
import { ensureDatasourceOntology } from './single-turn/ontology';
import { runSingleTurn } from './single-turn/main';

async function main(): Promise<void> {
  const dbId = process.env['BIRD_DB_ID'] ?? 'formula_1';
  const question =
    process.env['BIRD_QUESTION'] ??
    'List the top 5 drivers by total points in descending order.';

  const datasource = await prepareBirdDatasource(dbId);

  if (process.env['BIRD_BUILD_ONTOLOGY'] === '1') {
    const forceRebuild = process.env['BIRD_FORCE_REBUILD'] === '1';
    const result = await ensureDatasourceOntology({
      datasourceId: datasource.datasourceId,
      datasourceName: datasource.datasourceName,
      datasourceProvider: datasource.datasourceProvider,
      datasourceDriver: datasource.datasourceDriver,
      datasourceConfig: datasource.datasourceConfig,
      forceRebuild,
    });

    console.log(
      `[bird-single-turn] ontology ${result.reused ? 'reused' : 'built'} for ${result.datasourceId} (datasets=${result.datasetCount})`,
    );
  }

  process.env['QWERY_INTERNAL_SKIP_SEED'] = '1';
  process.env['DATASOURCE_PROVIDER'] = datasource.datasourceProvider;
  process.env['DATASOURCE_DRIVER'] = datasource.datasourceDriver;
  process.env['DATASOURCE_KIND'] = datasource.datasourceKind;
  process.env['DATASOURCE_ID'] = datasource.datasourceId;
  process.env['DATASOURCE_NAME'] = datasource.datasourceName;
  process.env['DATASOURCE_CONFIG_JSON'] = JSON.stringify(datasource.datasourceConfig);
  process.env['QUESTION'] = question;

  console.log('[bird-single-turn] dbId:', dbId);
  console.log('[bird-single-turn] sqlitePath:', datasource.sqlitePath);
  console.log('[bird-single-turn] duckdbPath:', datasource.duckdbPath);
  console.log('[bird-single-turn] question:', question);

  await runSingleTurn();
  process.exit(0);
}

main().catch((error) => {
  console.error(
    '[internal-agent/bird-single-turn] failed:',
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
