import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { askWithRetry } from '../lib/llm/retry.js';

describe('askWithRetry', () => {
  it('网络异常后会重试并恢复', async () => {
    let calls = 0;
    const result = await askWithRetry(async () => {
      calls++;
      if (calls === 1) throw new Error('temporary network error');
      return { say: '恢复了', play: [], reason: '', segue: '' };
    }, {}, { maxAttempts: 2 });

    assert.equal(calls, 2);
    assert.equal(result.say, '恢复了');
    assert.equal(result._meta.retried, true);
  });
});
