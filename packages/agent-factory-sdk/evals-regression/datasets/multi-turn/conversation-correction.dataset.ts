/**
 * Conversation Correction — conversation dataset
 *
 * Tests whether the agent incorporates user corrections mid-conversation.
 *
 * Register to backend:
 *   bun run evals-regression/datasets/multi-turn/conversation-correction.dataset.ts
 */

import { ConversationEvalDataset } from '@qwery/tracing-sdk/eval';

export const conversationCorrectionDataset = new ConversationEvalDataset({
  name: 'conversation-correction-evals',
  description: 'Multi-turn correction acceptance: table names, regions, KPIs, dates, aggregations',
  goldens: [
    {
      id: 'table-name-correction',
      turns: [
        { input: 'Use the customers table for this analysis.', groundTruth: 'Understood. I will reference the customers table.' },
        { input: 'Correction: the actual table is crm_customers.', groundTruth: 'Thanks for the correction. I will switch to crm_customers.' },
        { input: 'Great, now draft a query using the corrected table.', groundTruth: 'SELECT * FROM crm_customers LIMIT 100;' },
      ],
    },
    {
      id: 'region-value-correction',
      turns: [
        { input: 'Filter results to APAC.', groundTruth: 'Got it, I will filter to APAC.' },
        { input: 'Actually use LATAM, not APAC.', groundTruth: 'Understood, I will use LATAM instead.' },
        { input: 'Now summarize the next query plan.', groundTruth: 'I will continue with LATAM as the active region filter.' },
      ],
    },
    {
      id: 'kpi-correction',
      turns: [
        { input: 'Use ARR as the key KPI.', groundTruth: 'Understood. ARR will be the KPI.' },
        { input: 'Correction: use NRR as the KPI instead.', groundTruth: 'Thanks, I will use NRR instead of ARR.' },
        { input: 'What KPI are you using now?', groundTruth: 'I am using NRR.' },
      ],
    },
    {
      id: 'date-window-correction',
      turns: [
        { input: 'Use 2024 as the reporting year.', groundTruth: 'Understood. I will use 2024.' },
        { input: 'Correction: switch to 2025 data only.', groundTruth: 'Got it, I will switch the reporting year to 2025.' },
        { input: 'Summarize the active date scope.', groundTruth: 'The active date scope is 2025 only.' },
      ],
    },
    {
      id: 'aggregation-correction',
      turns: [
        { input: 'Aggregate by average order value.', groundTruth: 'I will aggregate by average order value.' },
        { input: 'Actually use total revenue instead of average.', groundTruth: 'Thanks for the correction. I will use total revenue.' },
        { input: 'What aggregate are you using now?', groundTruth: 'I am using total revenue.' },
      ],
    },
  ],
});

await conversationCorrectionDataset.push();

