import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db.js';
import {
  estimateCost,
  getDailyUsage,
  limitsForPlan,
  recordUsage,
} from '../lib/usage.js';

const userIds = [];
const originalEnv = {
  FREE_DAILY_MESSAGES: process.env.FREE_DAILY_MESSAGES,
  PRO_DAILY_MESSAGES: process.env.PRO_DAILY_MESSAGES,
  LLM_INPUT_USD_PER_MILLION: process.env.LLM_INPUT_USD_PER_MILLION,
  LLM_OUTPUT_USD_PER_MILLION: process.env.LLM_OUTPUT_USD_PER_MILLION,
};

function userId() {
  const id = `usage-test-${randomUUID()}`;
  userIds.push(id);
  return id;
}

beforeEach(() => {
  process.env.FREE_DAILY_MESSAGES = '2';
  process.env.PRO_DAILY_MESSAGES = '5';
  process.env.LLM_INPUT_USD_PER_MILLION = '1';
  process.env.LLM_OUTPUT_USD_PER_MILLION = '2';
});

after(() => {
  if (userIds.length) {
    const placeholders = userIds.map(() => '?').join(',');
    getDb().prepare(`DELETE FROM usage_events WHERE user_id IN (${placeholders})`).run(...userIds);
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('daily model usage', () => {
  it('uses plan-specific daily limits', () => {
    assert.equal(limitsForPlan('free').dailyMessages, 2);
    assert.equal(limitsForPlan('pro').dailyMessages, 5);
    assert.equal(limitsForPlan('admin').dailyMessages, null);
  });

  it('records tokens, estimates cost, and enforces the daily allowance', () => {
    const id = userId();
    recordUsage({
      userId: id,
      provider: 'openai',
      model: 'deepseek-chat',
      tokens: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
    });
    let usage = getDailyUsage(id, 'free');
    assert.equal(usage.used, 1);
    assert.equal(usage.remaining, 1);
    assert.equal(usage.tokens.total, 1500);
    assert.equal(usage.estimatedCostUsd, 0.002);
    assert.equal(usage.allowed, true);

    recordUsage({ userId: id, tokens: {} });
    usage = getDailyUsage(id, 'free');
    assert.equal(usage.remaining, 0);
    assert.equal(usage.allowed, false);
  });

  it('keeps user usage isolated and excludes failed calls from quota', () => {
    const first = userId();
    const second = userId();
    recordUsage({ userId: first, tokens: { total_tokens: 10 } });
    recordUsage({ userId: first, tokens: { total_tokens: 99 }, success: false });

    assert.equal(getDailyUsage(first, 'free').used, 1);
    assert.equal(getDailyUsage(first, 'free').tokens.total, 10);
    assert.equal(getDailyUsage(second, 'free').used, 0);
  });

  it('calculates configured token cost', () => {
    assert.equal(estimateCost({ prompt_tokens: 2_000_000, completion_tokens: 1_000_000 }), 4);
  });
});
