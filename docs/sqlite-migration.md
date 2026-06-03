# SQLite 替换 state.json 方案设计

> 版本：v0.1 草案  
> 日期：2026-05-27  
> 状态：设计阶段（实现推迟到第 3 周）

---

## 1. 动机

当前 `lib/state.js` 以单个 JSON 文件（`state/state.json`）存储所有状态：

| 问题 | 影响 |
|------|------|
| 全量序列化 | 每新增一条消息就重写整个文件，消息数 >1000 时 I/O 飙升 |
| 无查询能力 | 筛选/排序/分页全靠 `Array.filter`，O(n) 遍历 |
| 原子性缺失 | `writeFile` 非原子，断电可能损坏整个文件 |
| 扩展困难 | 后续加记忆表/配置表需手工解析嵌套 JSON |

**目标**：用 SQLite 替换 JSON 文件，保持 API 接口不变，提供迁移脚本。

---

## 2. 方案选型

| 方案 | 优点 | 缺点 | 推荐 |
|------|------|------|------|
| `better-sqlite3` | 同步 API、性能高、零配置 | 需 node-gyp 编译 | **推荐** |
| `sql.js` | 纯 WASM、无原生依赖 | 全量加载到内存、写入需手动序列化 | 备选 |
| LowDB v3 + JSON | 简单、无迁移成本 | 未解决根本问题 | 不推荐 |

**选择 `better-sqlite3`**，原因：
- 同步 API 简化代码（无需 async/await 改造）
- 写入直接落盘，不怕进程崩溃
- 社区活跃，Node.js 生态首选

---

## 3. 数据库 Schema

### 3.1 表设计

```sql
-- 元信息表（替代 state.json 顶层字段）
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 初始化：INSERT INTO meta VALUES ('created_at', '...'), ('version', '1');

-- 消息表
CREATE TABLE IF NOT EXISTS messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  role      TEXT NOT NULL,          -- 'user' | 'assistant'
  content   TEXT NOT NULL DEFAULT '',
  play      TEXT NOT NULL DEFAULT '[]',  -- JSON 数组
  reason    TEXT NOT NULL DEFAULT '',
  segue     TEXT NOT NULL DEFAULT '',
  source    TEXT NOT NULL DEFAULT '',
  ts        INTEGER NOT NULL,       -- Unix 毫秒时间戳
  persist   INTEGER NOT NULL DEFAULT 1  -- 是否持久化（1=是, 0=测试/手动触发）
);

CREATE INDEX idx_messages_ts ON messages(ts);
CREATE INDEX idx_messages_role ON messages(role);

-- 当前播放歌曲
CREATE TABLE IF NOT EXISTS now_playing (
  id         INTEGER PRIMARY KEY CHECK (id = 1),  -- 单行表
  song_id    TEXT,
  name       TEXT,
  artist     TEXT,
  album      TEXT,
  url        TEXT,
  keyword    TEXT,
  fetched_at INTEGER,
  started_at INTEGER,
  segue      TEXT DEFAULT ''
);
```

### 3.2 对比当前 JSON 结构

| JSON 字段 | SQLite 映射 |
|-----------|------------|
| `state.messages[]` | `messages` 表 |
| `state.nowPlaying` | `now_playing` 表（单行） |
| `state.createdAt` | `meta` 表 `key='created_at'` |

---

## 4. 接口改造（`lib/state.js` → `lib/db.js`）

### 4.1 核心 API 对照

| 现有方法 | 新方法 | 实现方式 |
|---------|--------|---------|
| `load()` | `db.init()` / 不再需要 | 启动时 `new Database(path)` |
| `save()` | 不再需要 | better-sqlite3 自动落盘 |
| `appendMessage(msg)` | 同 | `INSERT INTO messages ...` |
| `clearMessages()` | 同 | `DELETE FROM messages` |
| `pruneMessages({days, keep})` | 同 | `DELETE ... WHERE ts < cutoff` 或 `DELETE ... WHERE id NOT IN (SELECT id ... ORDER BY id DESC LIMIT ?)` |
| `setNowPlaying(song)` | 同 | `INSERT OR REPLACE INTO now_playing ...` |
| `filterDisplayMessages()` | SQL 层面实现 | `WHERE persist = 1 AND content != ''` |

### 4.2 新增能力

```javascript
// 按时间范围查询（原 JSON 需全量加载后 filter）
export function getMessagesSince(ts) {
  return db.prepare('SELECT * FROM messages WHERE ts >= ? AND persist = 1 ORDER BY ts ASC').all(ts);
}

// 统计消息数
export function messageCount() {
  return db.prepare('SELECT COUNT(*) as count FROM messages WHERE persist = 1').get().count;
}

// WAL 模式检查点（定期清理 WAL 文件）
export function checkpoint() {
  db.pragma('wal_checkpoint(TRUNCATE)');
}
```

### 4.3 接口兼容性

`lib/state.js` 保持导出的函数签名不变，内部实现从 JSON 切换到 SQLite：

```javascript
// state.js 改造后（伪代码）
import db from './db.js';

export async function appendMessage(msg) {
  if (!shouldPersistMessage(msg)) return;
  db.appendMessage(msg);
  // 不再需要 await save()
}

export async function load() {
  // 保留兼容，但不缓存全量
  return db.getAllMessages();
}
```

---

## 5. 迁移方案

### 5.1 迁移脚本 `scripts/migrate-to-sqlite.js`

```
1. 读取 state/state.json
2. 创建 state/claudio.db（如果已有则提示）
3. 初始化 schema
4. 逐条 INSERT messages（过滤 persist=0 的测试条目）
5. 写入 meta.created_at
6. 写入 now_playing
7. 输出统计：迁移 N 条消息，跳过 M 条
8. 重命名 state.json → state.json.bak（可选）
```

### 5.2 启动时自动迁移

`db.js` 初始化时检测：

```javascript
if (existsSync('.json') && !existsSync('.db')) {
  console.log('[db] 检测到旧 state.json，自动迁移到 SQLite...');
  runMigration();
}
```

### 5.3 回滚方案

- 保留 `state.json.bak`，可手动恢复
- `scripts/export-to-json.js` 反向导出

---

## 6. 配置与文件路径

```bash
# .env 新增
STATE_DB_PATH=state/claudio.db   # SQLite 文件路径
# 旧文件自动迁移后重命名为 state/state.json.bak
```

**WAL 模式**：开启 Write-Ahead Logging，提高并发读性能。

```javascript
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
```

---

## 7. 测试策略

| 层级 | 内容 |
|------|------|
| 单元测试 | `test/db.test.js`：CRUD、分页、剪裁、过滤 |
| 迁移测试 | `test/migrate.test.js`：模拟旧 JSON → 新 SQLite |
| 回归测试 | 现有 `npm test` 扩展，确保 state.js 接口不变 |

---

## 8. 实施步骤

1. [ ] `npm install better-sqlite3`
2. [ ] 实现 `lib/db.js`（schema、CRUD）
3. [ ] 将 `lib/state.js` 内部切换到 `db.js`，保持接口不变
4. [ ] 实现 `scripts/migrate-to-sqlite.js`
5. [ ] 添加 `scripts/export-to-json.js`
6. [ ] 编写 `test/db.test.js`
7. [ ] 回归测试全链路

---

## 9. 风险评估

| 风险 | 应对 |
|------|------|
| `better-sqlite3` 编译失败（Windows） | 预编译二进制通常可用；备选 `sql.js` |
| 迁移中断 | 事务包裹全部 INSERT |
| 旧代码仍引用 JSON 字段 | 保持 state.js 接口不变 |
| 性能退化 | SQLite 单表百万级无压力；WAL 模式保证并发 |
