/**
 * import-ncm — 网易云音乐数据导入 CLI
 *
 * 交互式流程：
 *   1. 尝试用缓存的 cookie 恢复登录
 *   2. 如需重新登录，提示输入手机号 + 密码
 *   3. 拉取听歌排行 / 歌单 / 红心歌曲
 *   4. 分析聚合数据
 *   5. 展示预览，等待用户确认
 *   6. 写入 prompts/ 品味文件
 *
 * 用法: node scripts/import-ncm.js  或  npm run import-ncm
 */

import * as readline from 'node:readline';
import { cwd } from 'node:process';

import {
  tryRestoreSession,
  login,
  fetchAll,
} from '../lib/import/ncm.js';

import { analyze } from '../lib/import/analyzer.js';
import { writeTasteFiles, dryRun } from '../lib/import/writer.js';

// ───────────────── 交互工具 ─────────────────

function ask(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

function askPassword(rl) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const onData = (c) => {
      const ch = c.toString();
      if (ch === '\r' || ch === '\n') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(false);
        process.stdout.write('\n');
        rl.resume();
        resolve(buf);
        return;
      }
      if (ch === '\x08' || ch === '\x7f') {
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      if (ch >= ' ') {
        buf += ch;
        process.stdout.write('*');
      }
    };
    let buf = '';
    rl.pause();
    process.stdout.write('密码 (输入不可见): ');
    stdin.setRawMode(true);
    stdin.on('data', onData);
  });
}

// ───────────────── 展示预览 ─────────────────

function showPreview(summary) {
  console.log('\n' + '─'.repeat(60));
  console.log('📊 数据预览');
  console.log('─'.repeat(60));

  console.log(`\n📀 听歌排行: ${summary.totalListened} 首`);
  console.log(`❤️  红心歌曲: ${summary.likedCount} 首`);
  console.log(`📋 歌单数量: ${summary.playlists.length} 个`);

  console.log('\n🏆 TOP 10 高频歌手:');
  summary.topArtists.slice(0, 10).forEach((a, i) => {
    const genreStr = a.genres.length ? ` [${a.genres.slice(0, 3).join(', ')}]` : '';
    console.log(`  ${String(i + 1).padStart(2)}. ${a.name} (${a.count}次)${genreStr}`);
  });

  console.log('\n🎵 风格分布 TOP 10:');
  summary.topGenres.slice(0, 10).forEach((g, i) => {
    const bar = '█'.repeat(Math.min(g.count, 30));
    console.log(`  ${String(i + 1).padStart(2)}. ${g.name.padEnd(20)} ${bar} ${g.count}`);
  });

  if (summary.era?.length) {
    console.log('\n📅 年代偏好:');
    summary.era.forEach((e) => {
      console.log(`  ${e.decade}: ${e.count}次`);
    });
  }

  console.log('\n📋 网易云歌单:');
  summary.playlists.slice(0, 10).forEach((p) => {
    const tags = p.tags?.length ? ` [${p.tags.join(', ')}]` : '';
    console.log(`  - ${p.name} (${p.trackCount || '?'}首)${tags}`);
  });
  if (summary.playlists.length > 10) {
    console.log(`  ... 以及其他 ${summary.playlists.length - 10} 个歌单`);
  }

  console.log('\n🚫 推断的讨厌风格:');
  console.log(`  ${(summary.hatedGenres || []).join('、')}`);

  console.log('\n' + '─'.repeat(60));
}

// ───────────────── 主流程 ─────────────────

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Claudio — 网易云音乐数据导入工具       ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  let session = null;

  // Step 1: 尝试恢复登录
  console.log('🔍 检查缓存的登录状态...');
  try {
    session = await tryRestoreSession();
  } catch { /* 忽略 */ }

  if (session) {
    console.log(`✅ 已恢复登录: UID ${session.uid}`);
  } else {
    // Step 2: 手机号登录
    console.log('⚠️  未找到有效登录状态，需要重新登录');
    console.log('');

    const phone = await ask(rl, '手机号: ');
    if (!phone) {
      console.log('❌ 手机号不能为空，退出');
      rl.close();
      process.exit(1);
    }

    const password = await askPassword(rl);
    if (!password) {
      console.log('❌ 密码不能为空，退出');
      rl.close();
      process.exit(1);
    }

    console.log('\n🔐 正在登录...');
    const result = await login(phone, password, '86');

    if (result.error) {
      console.log(`\n❌ ${result.error}`);
      rl.close();
      process.exit(1);
    }

    session = { cookie: result.cookie, uid: result.uid };
    console.log(`✅ 登录成功: UID ${session.uid}`);
  }

  // Step 3: 拉取数据
  console.log('\n📡 拉取听歌数据...');
  let raw;
  try {
    raw = await fetchAll(session.cookie, session.uid);
  } catch (e) {
    console.log(`❌ 拉取数据失败: ${e.message}`);
    rl.close();
    process.exit(1);
  }

  const allCount = raw.record.allData?.length || 0;
  const weekCount = raw.record.weekData?.length || 0;
  const playlistCount = raw.playlists?.length || 0;
  const likeCount = raw.likelist?.length || 0;

  console.log(`  所有时间排行: ${allCount} 首`);
  console.log(`  最近一周排行: ${weekCount} 首`);
  console.log(`  用户歌单:     ${playlistCount} 个`);
  console.log(`  红心歌曲:     ${likeCount} 首`);

  if (allCount === 0 && weekCount === 0) {
    console.log('\n⚠️  未拉取到听歌数据，可能原因:');
    console.log('  1. 账号听歌数据不足');
    console.log('  2. 隐私设置关闭了听歌排行');
    console.log('  3. API 限制');
  }

  // Step 4: 分析
  console.log('\n🧠 分析中...');
  const summary = analyze(raw);

  // Step 5: 预览
  showPreview(summary);

  // Step 6: 确认写入
  const answer = await ask(rl, '\n是否写入 prompts/ 品味文件？(y/n，默认 n): ');

  if (answer.toLowerCase() !== 'y') {
    console.log('\n🚫 已取消写入。数据未保存。');
    rl.close();
    return;
  }

  // Step 7: 写入
  console.log('\n💾 写入中...');
  try {
    const result = await writeTasteFiles(summary);

    console.log('✅ 写入完成！');
    console.log('');
    if (result.tasteBackup) console.log(`  备份 taste.md     → ${result.tasteBackup}`);
    if (result.playlistsBackup) console.log(`  备份 playlists.json → ${result.playlistsBackup}`);
    console.log(`  更新 taste.md`);
    console.log(`  更新 playlists.json (共 ${result.playlistsTotal} 个歌单，新增 ${result.playlistsAdded} 个)`);
    console.log('');
    console.log('💡 routines.md 和 mood-notes.json 未被修改，需手动维护。');
    console.log('💡 可调用 POST /api/reload 热更新品味文件。');
  } catch (e) {
    console.log(`❌ 写入失败: ${e.message}`);
  }

  rl.close();
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});