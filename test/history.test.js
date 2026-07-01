import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eligible } from '../lib/context/history.js';

describe('history eligible', () => {
  it('保留正常用户与助手对话', () => {
    assert.equal(eligible({ role: 'user', content: '你好', source: 'user' }), true);
    assert.equal(eligible({ role: 'assistant', content: '晚上好', source: 'user' }), true);
  });

  it('排除解析失败兜底回复', () => {
    assert.equal(eligible({
      role: 'assistant',
      content: '抱歉，我刚才没想好怎么说，你再说一遍？',
      source: 'user',
      reason: '(parse failed — using raw output as say)',
    }), false);
  });

  it('排除孤立的定时播报', () => {
    assert.equal(eligible({
      role: 'assistant',
      content: '晚上十点了，该休息了。',
      source: 'scheduled:evening',
    }), false);
  });

  it('排除离线降级回复', () => {
    assert.equal(eligible({
      role: 'assistant',
      content: '网络好像断了一下，不过没关系，我还在。',
      source: 'user',
      reason: '(offline fallback)',
    }), false);
  });
});
