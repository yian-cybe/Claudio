import { getDb } from './db.js';

/**
 * 记录一次 LLM 预测调用
 * @param {object} opts
 * @param {string} opts.input   - 输入文本（可截断）
 * @param {string} opts.output  - 输出文本（可截断）
 * @param {string} opts.provider - 提供者名称
 * @param {number} opts.latencyMs - 耗时（毫秒）
 */
export function logPrediction({ input, output, provider, latencyMs }) {
  const db = getDb();
  db.prepare(
    'INSERT INTO prediction_log (input, output, provider, latency_ms) VALUES (?, ?, ?, ?)'
  ).run(
    (input || '').slice(0, 4000),
    (output || '').slice(0, 4000),
    provider || '',
    latencyMs || 0
  );
}
