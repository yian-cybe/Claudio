import { spawn } from 'node:child_process';
import { delimiter, join, resolve } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { parseInner, ensureSay } from './_parse.js';

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-7[1m]';

// Windows: Node 拒绝直接 spawn .cmd/.bat(CVE-2024-27980),解析出 cli.js 路径直接 spawn node。
function findRunner() {
  const candidates = [
    resolve('node_modules/@anthropic-ai/claude-code/cli.js'),
    resolve('../node_modules/@anthropic-ai/claude-code/cli.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return { command: process.execPath, prefixArgs: [c] };
  }
  const paths = (process.env.PATH || '').split(delimiter);
  const exts = process.platform === 'win32'
    ? ['claude.cmd', 'claude.exe', 'claude.bat', 'claude']
    : ['claude'];
  for (const dir of paths) {
    if (!dir) continue;
    for (const name of exts) {
      const full = join(dir, name);
      if (!existsSync(full)) continue;
      if (name.endsWith('.cmd') || name.endsWith('.bat')) {
        const guess = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
        if (existsSync(guess)) return { command: process.execPath, prefixArgs: [guess] };
      }
      try {
        const real = realpathSync(full);
        if (real.endsWith('.js')) return { command: process.execPath, prefixArgs: [real] };
      } catch {}
      return { command: full, prefixArgs: [] };
    }
  }
  return { command: 'claude', prefixArgs: [] };
}

function findGitBash() {
  if (process.platform !== 'win32') return null;
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH) return process.env.CLAUDE_CODE_GIT_BASH_PATH;
  const guesses = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'D:\\Git\\bin\\bash.exe',
    'D:\\trae\\Git\\bin\\bash.exe',
    'D:\\trae\\Git\\usr\\bin\\bash.exe',
  ];
  for (const g of guesses) if (existsSync(g)) return g;
  const paths = (process.env.PATH || '').split(delimiter);
  for (const dir of paths) {
    const candidate = join(dir, 'bash.exe');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const RUNNER = findRunner();
const BASH_PATH = findGitBash();

function spawnClaude(args) {
  const env = { ...process.env };
  if (BASH_PATH) env.CLAUDE_CODE_GIT_BASH_PATH = BASH_PATH;
  return spawn(RUNNER.command, [...RUNNER.prefixArgs, ...args], { windowsHide: true, env });
}

function authStatus() {
  return new Promise((resolveP, rejectP) => {
    const proc = spawnClaude(['auth', 'status']);
    proc.stdin.end();
    let out = '', err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', rejectP);
    proc.on('close', (code) => {
      if (code !== 0) return rejectP(new Error(`claude auth status exit ${code}: ${err}`));
      try { resolveP(JSON.parse(out)); }
      catch (e) { rejectP(new Error(`auth status JSON parse failed: ${e.message}`)); }
    });
  });
}

function buildPrompt(userMessage, historyMessages) {
  if (!historyMessages?.length) return userMessage;
  const transcript = historyMessages
    .map((m) => `${m.role === 'user' ? '用户' : '主持人'}: ${m.content}`)
    .join('\n');
  return `# 近期对话\n${transcript}\n\n# 当前用户\n${userMessage}`;
}

export function ask({ userMessage, systemPrompt, historyMessages = [], model = DEFAULT_MODEL, timeoutMs = 30000 }) {
  return new Promise((resolveP, rejectP) => {
    const prompt = buildPrompt(userMessage, historyMessages);
    const args = [
      '-p', prompt,
      '--system-prompt', systemPrompt,
      '--model', model,
      '--output-format', 'json',
      '--tools', '',
      '--no-session-persistence',
      '--permission-mode', 'bypassPermissions',
    ];

    const proc = spawnClaude(args);
    proc.stdin.end();
    let stdout = '', stderr = '';
    const startMs = Date.now();

    const timer = setTimeout(() => {
      proc.kill();
      rejectP(new Error(`claude timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', (e) => { clearTimeout(timer); rejectP(e); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const wallMs = Date.now() - startMs;

      if (code !== 0) {
        return rejectP(new Error(`claude exit ${code}: ${stderr.slice(0, 600)}`));
      }

      let outer;
      try { outer = JSON.parse(stdout); }
      catch (e) { return rejectP(new Error(`outer JSON parse failed: ${e.message}\nhead: ${stdout.slice(0, 400)}`)); }

      if (outer.is_error) {
        return rejectP(new Error(`claude is_error: ${String(outer.result).slice(0, 400)}`));
      }

      const inner = ensureSay(parseInner(String(outer.result ?? '')));
      resolveP({
        ...inner,
        _meta: { wallMs, claudeDurationMs: outer.duration_ms, tokens: outer.usage, sessionId: outer.session_id },
      });
    });
  });
}

export async function info() {
  const detail = {
    runner: `${RUNNER.command} ${RUNNER.prefixArgs.join(' ')}`.trim(),
    bash: BASH_PATH || '(not needed)',
    model: DEFAULT_MODEL,
  };
  try {
    const auth = await authStatus();
    return { provider: 'claude', ready: !!auth.loggedIn, detail: { ...detail, auth } };
  } catch (e) {
    return { provider: 'claude', ready: false, detail, error: e.message };
  }
}
