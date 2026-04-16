/**
 * Context Retention — conversation dataset
 *
 * Focused multi-turn eval for remembering seeded entities across turns.
 *
 * Register to backend:
 *   bun run evals-regression/datasets/multi-turn/context-retention.dataset.ts
 */

import { ConversationEvalDataset } from '@qwery/tracing-sdk/eval';

export const contextRetentionDataset = new ConversationEvalDataset({
  name: 'context-retention-evals',
  description: 'Multi-turn context retention: table names, region filters, KPIs, time windows',
  goldens: [
    {
      id: 'retain-table-name',
      turns: [
        { input: 'We are working with the table `sales_2025` and it has around 10k rows.', groundTruth: 'Understood, I will use sales_2025 as the working table.' },
        { input: 'What kind of trend analysis can we do first?', groundTruth: 'We can start with weekly or monthly revenue trend analysis.' },
        { input: 'Remind me which table we said we are using.', groundTruth: 'We are using the sales_2025 table.' },
      ],
    },
    {
      id: 'retain-region-filter',
      turns: [
        { input: 'Please keep in mind our focus region is EMEA for this analysis.', groundTruth: 'Got it, I will keep EMEA as the focus region.' },
        { input: 'Show me a first-pass breakdown by category.', groundTruth: 'I can provide a category-level breakdown.' },
        { input: 'What region did we agree to focus on?', groundTruth: 'We agreed to focus on EMEA.' },
      ],
    },
    {
      id: 'retain-metric-name',
      turns: [
        { input: 'Track Gross Margin % as the main KPI in this conversation.', groundTruth: 'Understood, Gross Margin % will be the primary KPI.' },
        { input: 'Suggest a quick first query.', groundTruth: 'I can suggest a query grouped by date and product category.' },
        { input: 'Which KPI were we tracking again?', groundTruth: 'We were tracking Gross Margin %.' },
      ],
    },
    {
      id: 'retain-time-window',
      turns: [
        { input: 'Keep the analysis scoped to Q2 2025 only.', groundTruth: 'Understood. I will keep Q2 2025 as the active time window.' },
        { input: 'Propose two metrics we should inspect first.', groundTruth: 'We can start with revenue and gross margin trend in that period.' },
        { input: 'Which quarter are we scoped to?', groundTruth: 'We are scoped to Q2 2025.' },
      ],
    },
    {
      id: 'retain-table-alias',
      turns: [
        { input: 'Use `orders_fact` as our primary table in this conversation.', groundTruth: 'Got it. I will treat orders_fact as the primary table.' },
        { input: 'How should we aggregate by geography?', groundTruth: 'We can group by region and sum revenue or sales.' },
        { input: 'Confirm the table name before we continue.', groundTruth: 'We are using orders_fact.' },
      ],
    },
  ],
});

await contextRetentionDataset.push();

