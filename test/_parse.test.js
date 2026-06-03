// lib/llm/_parse.js 单元测试
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseInner, ensureSay, normalize, getDebugInfo, isDebugMode } from '../lib/llm/_parse.js';

describe('parseInner', () => {
  it('解析标准 JSON — say + play 均有效', () => {
    const raw = '{"say":"你好世界","play":[],"reason":"","segue":""}';
    const r = parseInner(raw);
    assert.equal(r.say, '你好世界');
    assert.deepEqual(r.play, []);
  });

  it('解析 fence 包裹的 JSON', () => {
    const raw = '```json\n{"say":"你好","play":["晴天"],"reason":"test"}\n```';
    const r = parseInner(raw);
    assert.equal(r.say, '你好');
    assert.deepEqual(r.play, ['晴天']);
  });

  it('解析裸对象但被前置文本包裹', () => {
    const raw = '好的，以下是回复：{"say":"点歌完成","play":["稻香"]}';
    const r = parseInner(raw);
    assert.equal(r.say, '点歌完成');
    assert.deepEqual(r.play, ['稻香']);
  });

  it('say 为空但 play 有值 → 正常返回', () => {
    const raw = '{"say":"","play":["夜曲"],"reason":""}';
    const r = parseInner(raw);
    assert.equal(r.say, '');
    assert.deepEqual(r.play, ['夜曲']);
  });

  it('纯文本 fallback — 无法解析 JSON', () => {
    const raw = '今天天气真好，给大家推荐一首歌。';
    const r = parseInner(raw);
    assert.equal(r.say, raw);
    assert.deepEqual(r.play, []);
    assert.ok(r._parseError);
    assert.ok(r._rawHead);
    assert.ok(r._rawHead.length <= 200);
  });

  it('空字符串 fallback', () => {
    const r = parseInner('');
    assert.equal(r.say, '');
    assert.equal(r._parseError, '(empty raw)');
  });

  it('null / undefined fallback', () => {
    const r = parseInner(null);
    assert.equal(r.say, '');
    assert.equal(r._parseError, '(empty raw)');
  });

  it('检测历史播放标签回声', () => {
    const raw = '[曾推荐播放：晴天 — 周杰伦] 这首歌很好听。';
    const r = parseInner(raw);
    assert.equal(r.say, '');
    assert.ok(r.reason.includes('echoed play tag'));
  });
});

describe('ensureSay', () => {
  it('say 非空 → 原样返回', () => {
    const r = ensureSay({ say: '你好', play: [], reason: 'test', segue: '' });
    assert.equal(r.say, '你好');
  });

  it('say 为空但 reason 有效 → say 取 reason 前 120 字', () => {
    const r = ensureSay({ say: '', play: [], reason: '从记忆中找到了匹配内容' });
    assert.ok(r.say.includes('从记忆中找到了匹配内容'));
  });

  it('say 为空 reason 为 parse failed → 用兜底句', () => {
    const r = ensureSay({ say: '', play: [], reason: '(parse failed — xxx)' });
    assert.ok(r.say.includes('抱歉'));
  });

  it('say 和 reason 均为空 → 兜底句', () => {
    const r = ensureSay({ say: '', play: [], reason: '' });
    assert.ok(r.say.includes('抱歉'));
  });
});

describe('normalize', () => {
  it('完整对象 → 保留所有字段', () => {
    const r = normalize({ say: 'hi', play: ['a'], reason: 'r', segue: 's', memorize: 'm' });
    assert.equal(r.say, 'hi');
    assert.deepEqual(r.play, ['a']);
    assert.equal(r.reason, 'r');
    assert.equal(r.segue, 's');
    assert.equal(r.memorize, 'm');
  });

  it('空对象 → 返回默认值', () => {
    const r = normalize({});
    assert.equal(r.say, '');
    assert.deepEqual(r.play, []);
    assert.equal(r.reason, '');
    assert.equal(r.segue, '');
    assert.equal(r.memorize, '');
  });

  it('null → 返回默认值', () => {
    const r = normalize(null);
    assert.equal(r.say, '');
  });

  it('play 非数组 → 转为空数组（防御）', () => {
    const r = normalize({ play: '单曲' });
    assert.deepEqual(r.play, []);
  });

  it('多余字段被忽略', () => {
    const r = normalize({ say: 'ok', extra: 'xxx' });
    assert.equal(r.say, 'ok');
    assert.equal(r.extra, undefined);
  });
});

describe('getDebugInfo', () => {
  it('无 _parseError → 返回 null', () => {
    assert.equal(getDebugInfo({ say: 'ok' }), null);
  });

  it('有 _parseError → 返回 rawHead', () => {
    const info = getDebugInfo({ _parseError: 'x'.repeat(300), reason: 'xxx' });
    assert.ok(info);
    assert.equal(info.reason, 'xxx');
    assert.equal(info.rawHead.length, 200);
  });
});

describe('isDebugMode', () => {
  it('默认 off', () => {
    assert.equal(isDebugMode(), false);
  });
});
