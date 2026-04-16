/**
 * Expanded Intent Coverage — single-turn dataset
 *
 * Covers help, feedback, datasource intents, multilingual queries, and goodbye.
 *
 * Register to backend:
 *   bun run evals-regression/datasets/single-turn/expanded-intent.dataset.ts
 */

import { EvalDataset } from '@qwery/tracing-sdk/eval';

export const expandedIntentDataset = new EvalDataset({
  name: 'expanded-intent-evals',
  description: 'Extended intent coverage: help, feedback, datasource, multilingual, goodbye',
  goldens: [
    {
      id: 'intent-help',
      input: 'Can you help me? I am not sure what you can do.',
      groundTruth: 'I can help you query data, generate charts, and more.',
      customMetrics: [
        { name: 'mentions_capabilities', fn: (out) => /query|chart|data|analyz|help|assist/i.test(out) ? 1 : 0 },
        { name: 'is_welcoming', fn: (out) => /help|assist|sure|happy|of course|absolutely/i.test(out) ? 1 : 0 },
        { name: 'appropriate_length', fn: (out) => out.trim().length > 20 ? 1 : 0 },
      ],
    },
    {
      id: 'intent-feedback',
      input: 'I have some feedback: the charts could be more colorful.',
      groundTruth: 'thank you for your feedback',
      customMetrics: [
        { name: 'acknowledges_feedback', fn: (out) => /thank|appreciate|noted|feedback|hear|value/i.test(out) ? 1 : 0 },
        { name: 'no_error_in_response', fn: (out) => /\b(error|exception|crash|failed)\b/i.test(out) ? 0 : 1 },
      ],
    },
    {
      id: 'intent-create-datasource',
      input: 'I want to add a new PostgreSQL database connection to Qwery',
      groundTruth: 'datasource',
      customMetrics: [
        { name: 'mentions_connection', fn: (out) => /connect|datasource|database|postgresql|postgres|add/i.test(out) ? 1 : 0 },
        { name: 'is_helpful_guidance', fn: (out) => out.trim().length > 30 ? 1 : 0 },
      ],
    },
    {
      id: 'intent-list-datasources',
      input: 'What databases and datasources am I currently connected to?',
      groundTruth: 'datasource',
      customMetrics: [
        { name: 'mentions_datasource', fn: (out) => /datasource|connect|database|list|attach/i.test(out) ? 1 : 0 },
        { name: 'appropriate_length', fn: (out) => out.trim().length > 15 ? 1 : 0 },
      ],
    },
    {
      id: 'intent-es-read-data',
      input: '¿Cuántos usuarios hay en la base de datos?',
      groundTruth: 'datos',
      customMetrics: [
        { name: 'is_data_response', fn: (out) => /query|sql|datos|usuario|data|database|connect|schema/i.test(out) ? 1 : 0 },
        { name: 'no_error_in_response', fn: (out) => /\b(error|exception|crash)\b/i.test(out) ? 0 : 1 },
        { name: 'appropriate_length', fn: (out) => out.trim().length > 15 ? 1 : 0 },
      ],
    },
    {
      id: 'intent-de-read-data',
      input: 'Wie viele Benutzer sind in der Datenbank gespeichert?',
      groundTruth: 'daten',
      customMetrics: [
        { name: 'is_data_response', fn: (out) => /query|sql|daten|benutzer|data|database|connect|schema/i.test(out) ? 1 : 0 },
        { name: 'no_error_in_response', fn: (out) => /\b(error|exception|crash)\b/i.test(out) ? 0 : 1 },
        { name: 'appropriate_length', fn: (out) => out.trim().length > 15 ? 1 : 0 },
      ],
    },
    {
      id: 'intent-ar-read-data',
      input: 'كم عدد المستخدمين في قاعدة البيانات؟',
      groundTruth: 'database',
      customMetrics: [
        { name: 'is_data_response', fn: (out) => /query|sql|data|database|user|connect|schema/i.test(out) ? 1 : 0 },
        { name: 'no_error_in_response', fn: (out) => /\b(error|exception|crash)\b/i.test(out) ? 0 : 1 },
        { name: 'appropriate_length', fn: (out) => out.trim().length > 15 ? 1 : 0 },
      ],
    },
    {
      id: 'intent-multi-turn-persistence',
      input: '[Previous question: "Show me total sales by product category"]\n\nThanks, that was really helpful!',
      groundTruth: 'data',
      customMetrics: [
        { name: 'maintains_context', fn: (out) => /data|query|result|sales|categor|product|chart/i.test(out) ? 1 : 0 },
        { name: 'is_friendly', fn: (out) => /welcome|glad|happy|help|great|anytime/i.test(out) ? 1 : 0 },
        { name: 'no_error_in_response', fn: (out) => /\b(error|exception|crash)\b/i.test(out) ? 0 : 1 },
      ],
    },
    {
      id: 'intent-goodbye',
      input: 'Thanks for your help, goodbye!',
      groundTruth: 'goodbye',
      customMetrics: [
        { name: 'is_polite_farewell', fn: (out) => /bye|goodbye|see you|take care|welcome|anytime|pleasure/i.test(out) ? 1 : 0 },
        { name: 'no_error_in_response', fn: (out) => /\b(error|exception|crash)\b/i.test(out) ? 0 : 1 },
      ],
    },
  ],
});

await expandedIntentDataset.push();

