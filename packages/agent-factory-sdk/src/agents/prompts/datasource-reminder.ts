/**
 * Builds a system-reminder text for attached datasources.
 * Used by the generic insertReminders flow; oriented toward the query agent.
 * Only takes the list of names/ids (no full orchestration result).
 */
export function buildDatasourceReminder(
  attachedDatasourceNames: string[],
): string {
  const wrapped = (content: string) =>
    `<system-reminder>\n${content}\n</system-reminder>`;

  if (attachedDatasourceNames.length > 0) {
    const list = attachedDatasourceNames.join(', ');
    return wrapped(
      `The following datasources are currently attached: ${list}. ` +
        `To answer data questions: use search_ontology to find relevant datasets, ` +
        `get_relationships to discover joins, then write SQL and call runQuery. ` +
        `Use getSchema with detailLevel="simple" for a full dataset overview.`,
    );
  }

  return wrapped(
    'No datasources are currently attached. If the user asks about data, direct them to attach a datasource first.',
  );
}
