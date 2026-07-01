import { getDb } from './db.js';

const DEFAULT_LIMITS = {
  free: 10,
  pro: 200,
};

function nonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function ensureTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_usage_user_created ON usage_events(user_id, created_at)');
  return db;
}

export function limitsForPlan(plan = 'free') {
  if (plan === 'admin' || plan === 'unlimited') {
    return { dailyMessages: null };
  }
  const fallback = DEFAULT_LIMITS[plan] || DEFAULT_LIMITS.free;
  const envName = plan === 'pro' ? 'PRO_DAILY_MESSAGES' : 'FREE_DAILY_MESSAGES';
  return { dailyMessages: positiveInteger(process.env[envName], fallback) };
}

export function estimateCost(tokens = {}) {
  const promptTokens = nonNegativeNumber(tokens.prompt_tokens);
  const completionTokens = nonNegativeNumber(tokens.completion_tokens);
  const inputRate = nonNegativeNumber(process.env.LLM_INPUT_USD_PER_MILLION);
  const outputRate = nonNegativeNumber(process.env.LLM_OUTPUT_USD_PER_MILLION);
  return ((promptTokens * inputRate) + (completionTokens * outputRate)) / 1_000_000;
}

export function recordUsage({ userId, provider = '', model = '', tokens = {}, success = true }) {
  if (!userId) throw new Error('userId required');
  const promptTokens = Math.round(nonNegativeNumber(tokens.prompt_tokens));
  const completionTokens = Math.round(nonNegativeNumber(tokens.completion_tokens));
  const totalTokens = Math.round(nonNegativeNumber(
    tokens.total_tokens,
    promptTokens + completionTokens
  ));
  const estimatedCostUsd = estimateCost({ prompt_tokens: promptTokens, completion_tokens: completionTokens });

  ensureTable().prepare(`
    INSERT INTO usage_events (
      user_id, provider, model, prompt_tokens, completion_tokens,
      total_tokens, estimated_cost_usd, success
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(userId),
    String(provider || ''),
    String(model || ''),
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUsd,
    success ? 1 : 0
  );

  return { promptTokens, completionTokens, totalTokens, estimatedCostUsd, success: !!success };
}

export function getDailyUsage(userId, plan = 'free') {
  if (!userId) throw new Error('userId required');
  const row = ensureTable().prepare(`
    SELECT
      COUNT(*) AS messages,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
    FROM usage_events
    WHERE user_id = ? AND success = 1 AND date(created_at) = date('now')
  `).get(String(userId));
  const limit = limitsForPlan(plan).dailyMessages;
  const used = Number(row.messages) || 0;

  return {
    plan,
    period: 'day',
    limit,
    used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    allowed: limit === null || used < limit,
    tokens: {
      prompt: Number(row.prompt_tokens) || 0,
      completion: Number(row.completion_tokens) || 0,
      total: Number(row.total_tokens) || 0,
    },
    estimatedCostUsd: Number(row.estimated_cost_usd) || 0,
    costConfigured: nonNegativeNumber(process.env.LLM_INPUT_USD_PER_MILLION) > 0
      || nonNegativeNumber(process.env.LLM_OUTPUT_USD_PER_MILLION) > 0,
  };
}

