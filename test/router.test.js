// lib/router.js 单元测试
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../lib/router.js';

describe('route', () => {
  it('scheduledFragment 存在 → llm', () => {
    const r = route({ message: '随便什么', source: 'scheduled:morning', scheduledFragment: '早间播报' });
    assert.equal(r.mode, 'llm');
    assert.equal(r.reason, 'scheduled');
  });

  it('空消息 → skip', () => {
    const r = route({ message: '', source: 'user' });
    assert.equal(r.mode, 'skip');
    assert.equal(r.reason, 'empty');
  });

  it('null 消息 → skip', () => {
    const r = route({ message: null, source: 'user' });
    assert.equal(r.mode, 'skip');
  });

  it('纯空格消息 → skip', () => {
    const r = route({ message: '   ', source: 'user' });
    assert.equal(r.mode, 'skip');
  });

  // --- 音乐前缀命令 ---

  it('/play: 中文冒号 → music', () => {
    const r = route({ message: '/play：晴天', source: 'user' });
    assert.equal(r.mode, 'music');
    assert.equal(r.keyword, '晴天');
  });

  it('/play: 英文冒号 → music', () => {
    const r = route({ message: '/play: 晴天', source: 'user' });
    assert.equal(r.mode, 'music');
    assert.equal(r.keyword, '晴天');
  });

  it('播放： → music', () => {
    const r = route({ message: '播放：晴天', source: 'user' });
    assert.equal(r.mode, 'music');
    assert.equal(r.keyword, '晴天');
  });

  it('点歌： → music', () => {
    const r = route({ message: '点歌：晴天', source: 'user' });
    assert.equal(r.mode, 'music');
  });

  it('来首： → music', () => {
    const r = route({ message: '来首：晴天', source: 'user' });
    assert.equal(r.mode, 'music');
  });

  it('放首： → music', () => {
    const r = route({ message: '放首：晴天', source: 'user' });
    assert.equal(r.mode, 'music');
  });

  it('放一首： → music', () => {
    const r = route({ message: '放一首：晴天', source: 'user' });
    assert.equal(r.mode, 'music');
  });

  // --- 音乐内联命令 ---

  it('来首 + 关键词(≥2字) → music', () => {
    const r = route({ message: '来首晴天', source: 'user' });
    assert.equal(r.mode, 'music');
    assert.equal(r.keyword, '晴天');
  });

  it('放首 + 关键词 → music', () => {
    const r = route({ message: '放首晴天', source: 'user' });
    assert.equal(r.mode, 'music');
  });

  it('来首 + 单字关键词 → skip（长度不足）', () => {
    const r = route({ message: '来首天', source: 'user' });
    assert.equal(r.mode, 'llm'); // 单字不足 2，走默认
  });

  // --- 非 user source 不触发音乐 ---

  it('scheduled 来源 + 音乐关键词 → llm', () => {
    const r = route({ message: '播放：晴天', source: 'scheduled:morning' });
    assert.equal(r.mode, 'llm');
  });

  // --- 默认 llm ---

  it('普通闲聊 → llm', () => {
    const r = route({ message: '今天天气怎么样？', source: 'user' });
    assert.equal(r.mode, 'llm');
    assert.equal(r.reason, 'default');
  });

  it('带音乐关键词但无命令前缀 → llm', () => {
    const r = route({ message: '我想听晴天', source: 'user' });
    assert.equal(r.mode, 'llm');
  });
});
