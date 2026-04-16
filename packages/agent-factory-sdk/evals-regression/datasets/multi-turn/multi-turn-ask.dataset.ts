/**
 * Multi-turn Ask Agent — conversation dataset
 *
 * Evaluates the Ask agent across full conversation flows.
 *
 * Register to backend:
 *   bun run evals-regression/datasets/multi-turn/multi-turn-ask.dataset.ts
 */

import { ConversationEvalDataset } from '@qwery/tracing-sdk/eval';

export const multiTurnAskDataset = new ConversationEvalDataset({
  name: 'multi-turn-ask-evals',
  description: 'Multi-turn Ask agent conversation evaluation — greeting→query, schema, clarification, follow-ups',
  goldens: [
    {
      id: 'greeting-to-data-query',
      turns: [
        { input: 'Hi, I am analyzing sales data today.', groundTruth: 'Hello! I can help you analyze your sales data.' },
        { input: 'Great, can you help me query total revenue by month?', groundTruth: 'Yes, I can help build a monthly revenue query.' },
      ],
    },
    {
      id: 'schema-then-query',
      turns: [
        { input: 'First tell me what columns are in the orders table.', groundTruth: 'I should inspect the orders table schema first.' },
        { input: 'Now write a SQL query to compute total sales by region from that table.', groundTruth: 'SELECT region, SUM(sales) FROM orders GROUP BY region;' },
      ],
    },
    {
      id: 'clarification-loop',
      turns: [
        { input: 'Show me performance trends.', groundTruth: 'Could you clarify the metric and timeframe?' },
        { input: 'By performance I mean weekly revenue for the last 8 weeks.', groundTruth: 'Understood. I can now focus on weekly revenue over the last 8 weeks.' },
      ],
    },
    {
      id: 'follow-up-filter',
      turns: [
        { input: 'Show revenue by product category.', groundTruth: 'I can return revenue aggregated by product category.' },
        { input: 'Now filter that to Europe only.', groundTruth: 'Sure, I will keep the same query and filter results to Europe.' },
      ],
    },
    {
      id: 'error-recovery-correction',
      turns: [
        { input: 'What table should I use for customer invoices?', groundTruth: 'Use the invoices table as the primary source.' },
        { input: 'Actually in our schema it is billing_invoices, not invoices.', groundTruth: 'Thanks for the correction. I will use billing_invoices going forward.' },
      ],
    },
    {
      id: 'result-followup-sort',
      turns: [
        { input: 'Show total sales by region.', groundTruth: 'I can aggregate total sales by region.' },
        { input: 'Now sort those results descending by total sales.', groundTruth: 'Sure, I will keep the same aggregation and order by total sales descending.' },
      ],
    },
    {
      id: 'chart-refinement-followup',
      turns: [
        { input: 'Recommend a chart for monthly revenue trend.', groundTruth: 'A line chart is a strong choice for monthly trends.' },
        { input: 'Actually switch to a bar chart and explain trade-offs.', groundTruth: 'I can switch to bar chart; line emphasizes continuity while bar supports discrete comparison.' },
      ],
    },
    {
      id: 'constraint-update-mid-conversation',
      turns: [
        { input: 'Draft SQL for top customers by revenue.', groundTruth: 'I can produce SQL to rank customers by revenue.' },
        { input: 'Add a constraint to only include 2025 orders.', groundTruth: 'Understood. I will retain the ranking logic and add a 2025 date filter.' },
      ],
    },
  ],
});

await multiTurnAskDataset.push();

