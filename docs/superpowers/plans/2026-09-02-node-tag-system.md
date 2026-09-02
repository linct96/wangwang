# Node Tag System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 wangwang 的节点标签从“JSON 字符串数组 + 逗号输入框”升级为可复用的一等标签实体，实现节点标签可创建多选、已有标签直接选中、节点列表按标签筛选，并让 Source 继承标签与 Profile 标签筛选继续保持一致语义。

**Architecture:** 新增 `tags`、`node_tags`、`source_tags`、`profile_tag_filters` 四张关系表，以关系表作为标签查询与筛选的权威数据源；现有 `nodes.tags`、`sources.node_tag`、`profiles.tags` 暂不删除，并在本版本继续双写用于回滚兼容。新增独立 Tag Store/Model 和 `/api/tags` 目录接口，前端实现无新增依赖的 Creatable MultiSelect；节点有效标签定义为“节点直接标签 ∪ 启用来源继承标签”，Profile 标签过滤继续保持 OR 语义。

**Tech Stack:** TypeScript 6、React 19、Hono、Cloudflare Workers/D1、Drizzle ORM、Zod、TanStack React Form、Radix UI、Vitest、pnpm。

**Spec:** `docs/superpowers/plans/2026-09-02-node-tag-system.md#design-contract`

## Global Constraints

- 节点总量上限保持 2000，不修改现有容量限制。
- 节点直接标签最多 10 个；单个标签 trim 后长度 1~24 字符。
- Profile 标签过滤最多 20 个；单个标签长度 1~24 字符。
- Source 本次仍保持“单个继承标签”的现有产品行为；数据库使用 `source_tags` 多对多结构，为后续多标签预留能力，但本次不扩展 Source UI 为多选。
- Node 写接口继续接受 `tags: string[]`，不要求现有调用方改为提交 tag ID。
- Profile 写接口继续接受 `tags: string[]`。
- `nodes.tags`、`sources.node_tag`、`profiles.tags` 本次不得删除；新旧结构必须同步写入。删除旧字段应作为后续独立迁移。
- 标签目录中无引用标签不自动删除，避免用户暂时移除标签后目录项消失。
- 新标签只在提交 Node/Source 表单时落库；不得在用户输入过程中即时创建数据库记录。
- 节点有效标签：`effective = direct ∪ inheritedFromEnabledSources`。
- Profile 标签筛选语义保持 OR：Profile 选择任意一个标签，节点命中其中任意标签即可进入配置。
- Node 列表标签筛选必须同时匹配直接标签与启用 Source 继承标签。
- 不新增 npm 依赖；复用现有 `Popover`、`Input`、`Badge`、`Button`、`Select` 等组件。
- 所有新 D1 外键关系使用 `ON DELETE CASCADE`；删除 Node/Source/Profile 时只清理关联关系，不自动删除 `tags` 目录项。
- 每个任务完成后执行对应测试；最终必须通过 `pnpm test`、`pnpm lint`、`pnpm format:check`、`pnpm build`。

---

## Design Contract

### 1. 数据模型

新增：

```text
tags
├── id TEXT PRIMARY KEY
├── name TEXT NOT NULL
├── normalized_name TEXT NOT NULL UNIQUE
├── created_at INTEGER NOT NULL
└── updated_at INTEGER NOT NULL

node_tags
├── node_id TEXT NOT NULL FK nodes.id ON DELETE CASCADE
├── tag_id TEXT NOT NULL FK tags.id ON DELETE CASCADE
└── PRIMARY KEY(node_id, tag_id)

source_tags
├── source_id TEXT NOT NULL FK sources.id ON DELETE CASCADE
├── tag_id TEXT NOT NULL FK tags.id ON DELETE CASCADE
└── PRIMARY KEY(source_id, tag_id)

profile_tag_filters
├── profile_id TEXT NOT NULL FK profiles.id ON DELETE CASCADE
├── tag_id TEXT NOT NULL FK tags.id ON DELETE CASCADE
└── PRIMARY KEY(profile_id, tag_id)
```

附加索引：

```text
node_tags(tag_id, node_id)
source_tags(tag_id, source_id)
profile_tag_filters(tag_id, profile_id)
```

### 2. 标签规范化

为保证 D1 SQL backfill 与运行时行为一致，本版本使用保守规范化，不做 Unicode NFKC 或 Unicode case folding：

```ts
export function normalizeTagName(value: string) {
  return value.trim().replace(/[A-Z]/g, (char) => char.toLowerCase())
}
```

因此：

```text
HK -> hk
hk -> hk
香港 -> 香港
ＨＫ -> ＨＫ
```

显示名称 `name` 保存第一次创建时 trim 后的原始大小写；唯一性由 `normalized_name` 控制。

### 3. API 合同

新增：

```http
GET /api/tags
```

响应：

```json
{
  "data": [
    { "id": "tag_xxx", "name": "香港" },
    { "id": "tag_yyy", "name": "高速" }
  ]
}
```

节点列表新增筛选参数：

```http
GET /api/nodes?tagId=<tag-id>&protocol=&enabled=&page=1&pageSize=50
```

`NodeItem` 保留原有：

```ts
tags: string[] // effective tag names，兼容现有表格显示
```

新增：

```ts
export type TagOption = {
  id: string
  name: string
}

export type NodeItem = {
  // existing fields...
  tags: string[]
  directTags: TagOption[]
  inheritedTags: TagOption[]
}
```

`PATCH /api/nodes/:id` 仍提交：

```json
{
  "tags": ["高速", "游戏"]
}
```

后端负责：规范化 -> 查找/创建 Tag -> 替换 `node_tags` -> 同步 legacy `nodes.tags`。

### 4. UI 合同

Node 新增/编辑页使用 Creatable MultiSelect：

- 已存在标签：选择后直接加入。
- 输入不存在名称：显示 `创建「xxx」`，按 Enter/点击后仅加入当前表单值，真正写库发生在保存 Node 时。
- 已选择标签以 Badge 显示，可删除。
- 编辑 Node 时 `inheritedTags` 单独显示为不可删除 Badge，并注明“来源继承”。
- 最多 10 个 direct tags；达到上限后禁止继续创建/选择，并显示提示。

Node 列表工具栏新增“全部标签”筛选 Select；选中后传 `tagId`，切换标签时页码重置为 1。

Profile 的“标签筛选”改为非 Creatable 多选：只能选择 `/api/tags` 已存在标签，避免创建没有任何 Node 使用的筛选标签；提交仍为名称数组。

### 5. 兼容策略

本版本关系表是读路径权威数据源，但 legacy 字段继续双写：

```text
Node: node_tags <-> nodes.tags
Source: source_tags <-> sources.node_tag（当前仅 0/1 个）
Profile: profile_tag_filters <-> profiles.tags
```

代码稳定后可单独创建下一份 migration 删除 legacy 字段；本计划不得执行删除。

---

## File Structure

### 新建

- `worker/tag-model.ts`：纯函数，负责标签规范化、去重、有效标签合并、OR 匹配；不得访问数据库。
- `worker/tag-store.ts`：标签目录和四类关系的 D1/Drizzle 数据访问；所有标签数据库逻辑集中于此。
- `worker/routes/tags.ts`：`GET /api/tags`。
- `src/components/tag-multi-select.tsx`：可创建多选组件，同时支持 `allowCreate={false}`。
- `tests/tag-model.test.ts`：纯函数单测。

### 修改

- `worker/db.ts`：新增四张表及 relations/index。
- `drizzle/0001_normalize_tags.sql`：Drizzle 生成后追加 legacy backfill SQL。
- `drizzle/meta/0001_snapshot.json`：由 Drizzle Kit 自动生成。
- `drizzle/meta/_journal.json`：由 Drizzle Kit 自动更新。
- `worker/app.ts`：注册 `/api/tags`。
- `worker/routes/nodes.ts`：关系表读写、`tagId` 筛选、direct/inherited/effective 输出。
- `worker/node-config.ts`：移除旧的 `nodeSourceTags` 数据访问职责或改为调用 Tag Store；保留节点连接配置职责。
- `worker/routes/sources.ts`：同步 `source_tags` 与 legacy `node_tag`。
- `worker/routes/profiles.ts`：同步 `profile_tag_filters` 与 legacy `profiles.tags`。
- `worker/tasks.ts`：Profile 编译使用关系表有效标签，不再依赖 `mergeNodeTags(nodes.tags, source.nodeTag)` 作为权威来源。
- `src/api/types.ts`：新增 `TagOption`、`NodeItem.directTags`、`NodeItem.inheritedTags`。
- `src/features/nodes/node-dialogs.tsx`：字符串输入改为 Creatable MultiSelect，仅编辑 direct tags。
- `src/features/nodes/page.tsx`：加载标签目录并增加 `tagId` 过滤 Select。
- `src/features/profiles/profile-dialog.tsx`：Profile 标签筛选改为现有标签多选。

---

### Task 1: 建立可测试的标签领域模型

**Files:**
- Create: `worker/tag-model.ts`
- Create: `tests/tag-model.test.ts`

**Interfaces:**
- Produces: `TagRecord`, `TagView`, `normalizeTagName`, `normalizeTagInputs`, `mergeTagViews`, `matchesAnyTag`。
- Consumes: 无数据库依赖。

- [ ] **Step 1: 写失败测试**

创建 `tests/tag-model.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { matchesAnyTag, mergeTagViews, normalizeTagInputs, normalizeTagName } from '../worker/tag-model'

describe('tag model', () => {
  it('normalizes ASCII case and trims whitespace', () => {
    expect(normalizeTagName('  HK  ')).toBe('hk')
    expect(normalizeTagName(' 香港 ')).toBe('香港')
  })

  it('deduplicates by normalized name and preserves first display name', () => {
    expect(normalizeTagInputs(['HK', ' hk ', '香港'], 10)).toEqual(['HK', '香港'])
  })

  it('rejects empty, too long, and over-limit tags', () => {
    expect(() => normalizeTagInputs([''], 10)).toThrow('标签不能为空')
    expect(() => normalizeTagInputs(['a'.repeat(25)], 10)).toThrow('单个标签不能超过 24 个字符')
    expect(() => normalizeTagInputs(Array.from({ length: 11 }, (_, i) => `tag-${i}`), 10)).toThrow(
      '标签不能超过 10 个',
    )
  })

  it('merges direct and inherited tags by id', () => {
    const direct = [{ id: 'a', name: '高速' }]
    const inherited = [
      { id: 'b', name: '香港' },
      { id: 'a', name: '高速' },
    ]
    expect(mergeTagViews(direct, inherited)).toEqual([
      { id: 'a', name: '高速' },
      { id: 'b', name: '香港' },
    ])
  })

  it('matches profile filters with OR semantics', () => {
    expect(matchesAnyTag(['a', 'b'], [])).toBe(true)
    expect(matchesAnyTag(['a', 'b'], ['b', 'c'])).toBe(true)
    expect(matchesAnyTag(['a'], ['b'])).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm vitest run tests/tag-model.test.ts
```

Expected: FAIL，因为 `worker/tag-model.ts` 尚不存在。

- [ ] **Step 3: 实现最小领域模型**

创建 `worker/tag-model.ts`：

```ts
export type TagRecord = {
  id: string
  name: string
  normalizedName: string
}

export type TagView = Pick<TagRecord, 'id' | 'name'>

export function normalizeTagName(value: string) {
  return value.trim().replace(/[A-Z]/g, (char) => char.toLowerCase())
}

export function normalizeTagInputs(values: string[], max: number) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const name = raw.trim()
    if (!name) throw new Error('标签不能为空')
    if (name.length > 24) throw new Error('单个标签不能超过 24 个字符')
    const normalized = normalizeTagName(name)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(name)
  }
  if (result.length > max) throw new Error(`标签不能超过 ${max} 个`)
  return result
}

export function mergeTagViews(direct: TagView[], inherited: TagView[]) {
  const result = new Map<string, TagView>()
  for (const tag of [...direct, ...inherited]) if (!result.has(tag.id)) result.set(tag.id, tag)
  return [...result.values()]
}

export function matchesAnyTag(nodeTagIds: string[], filterTagIds: string[]) {
  if (!filterTagIds.length) return true
  const nodeTags = new Set(nodeTagIds)
  return filterTagIds.some((id) => nodeTags.has(id))
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm vitest run tests/tag-model.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add worker/tag-model.ts tests/tag-model.test.ts
git commit -m "feat: add tag domain model"
```

---

### Task 2: 新增标签表结构与安全 backfill migration

**Files:**
- Modify: `worker/db.ts`
- Create/generated: `drizzle/0001_normalize_tags.sql`
- Create/generated: `drizzle/meta/0001_snapshot.json`
- Modify/generated: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces: Drizzle tables `tags`, `nodeTags`, `sourceTags`, `profileTagFilters`。
- Consumes: Task 1 的规范化约定；SQL backfill 使用 `lower(trim(...))`，与 ASCII lower 规则一致。

- [ ] **Step 1: 在 `worker/db.ts` 增加 schema**

在 `nodes` 定义之后加入：

```ts
export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('tags_normalized_name_idx').on(table.normalizedName)],
)

export const nodeTags = sqliteTable(
  'node_tags',
  {
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.nodeId, table.tagId] }),
    index('node_tags_tag_idx').on(table.tagId, table.nodeId),
  ],
)
```

在 `sources`、`profiles` 已声明完成后增加对应 `sourceTags`、`profileTagFilters`。由于 `sourceTags` 依赖 `sources`、`profileTagFilters` 依赖 `profiles`，不要把它们定义在被引用表之前：

```ts
export const sourceTags = sqliteTable(
  'source_tags',
  {
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.sourceId, table.tagId] }),
    index('source_tags_tag_idx').on(table.tagId, table.sourceId),
  ],
)

export const profileTagFilters = sqliteTable(
  'profile_tag_filters',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.tagId] }),
    index('profile_tag_filters_tag_idx').on(table.tagId, table.profileId),
  ],
)
```

- [ ] **Step 2: 生成精确 migration 文件**

Run:

```bash
pnpm exec drizzle-kit generate --name normalize_tags
```

Expected: 生成 `drizzle/0001_normalize_tags.sql`，并更新 Drizzle meta 文件。若生成器因现有 journal 编号产生不同序号，先确认当前仓库只有 `0000_initial.sql`，不得手工覆盖既有 migration。

- [ ] **Step 3: 在 migration 建表语句之后追加 backfill SQL**

追加以下 SQL；不要删除 legacy 列：

```sql
INSERT OR IGNORE INTO tags (id, name, normalized_name, created_at, updated_at)
SELECT 'tag_' || lower(hex(randomblob(12))), trim(CAST(j.value AS TEXT)), lower(trim(CAST(j.value AS TEXT))), unixepoch('subsec') * 1000, unixepoch('subsec') * 1000
FROM nodes n, json_each(n.tags) j
WHERE trim(CAST(j.value AS TEXT)) <> '';

INSERT OR IGNORE INTO tags (id, name, normalized_name, created_at, updated_at)
SELECT 'tag_' || lower(hex(randomblob(12))), trim(s.node_tag), lower(trim(s.node_tag)), unixepoch('subsec') * 1000, unixepoch('subsec') * 1000
FROM sources s
WHERE s.node_tag IS NOT NULL AND trim(s.node_tag) <> '';

INSERT OR IGNORE INTO tags (id, name, normalized_name, created_at, updated_at)
SELECT 'tag_' || lower(hex(randomblob(12))), trim(CAST(j.value AS TEXT)), lower(trim(CAST(j.value AS TEXT))), unixepoch('subsec') * 1000, unixepoch('subsec') * 1000
FROM profiles p, json_each(p.tags) j
WHERE trim(CAST(j.value AS TEXT)) <> '';

INSERT OR IGNORE INTO node_tags (node_id, tag_id)
SELECT n.id, t.id
FROM nodes n, json_each(n.tags) j
JOIN tags t ON t.normalized_name = lower(trim(CAST(j.value AS TEXT)))
WHERE trim(CAST(j.value AS TEXT)) <> '';

INSERT OR IGNORE INTO source_tags (source_id, tag_id)
SELECT s.id, t.id
FROM sources s
JOIN tags t ON t.normalized_name = lower(trim(s.node_tag))
WHERE s.node_tag IS NOT NULL AND trim(s.node_tag) <> '';

INSERT OR IGNORE INTO profile_tag_filters (profile_id, tag_id)
SELECT p.id, t.id
FROM profiles p, json_each(p.tags) j
JOIN tags t ON t.normalized_name = lower(trim(CAST(j.value AS TEXT)))
WHERE trim(CAST(j.value AS TEXT)) <> '';
```

- [ ] **Step 4: 对空本地 D1 执行 migration**

```bash
pnpm db:migrate:local
```

Expected: `0000_initial.sql` 与 `0001_normalize_tags.sql` 均成功应用，或现有本地库只应用尚未执行的 `0001`。

- [ ] **Step 5: 检查 schema 与孤儿关系**

```bash
pnpm exec wrangler d1 execute DB --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tags','node_tags','source_tags','profile_tag_filters') ORDER BY name;"
pnpm exec wrangler d1 execute DB --local --command "SELECT count(*) AS orphan_node_tags FROM node_tags nt LEFT JOIN nodes n ON n.id=nt.node_id LEFT JOIN tags t ON t.id=nt.tag_id WHERE n.id IS NULL OR t.id IS NULL;"
```

Expected: 第一条返回 4 张表；第二条 `orphan_node_tags = 0`。

- [ ] **Step 6: 运行类型检查/构建**

```bash
pnpm build
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add worker/db.ts drizzle
git commit -m "feat: normalize tag persistence"
```

---

### Task 3: 实现 Tag Store 与标签目录接口

**Files:**
- Create: `worker/tag-store.ts`
- Create: `worker/routes/tags.ts`
- Modify: `worker/app.ts`

**Interfaces:**
- Consumes: `tags`, `nodeTags`, `sourceTags`, `profileTagFilters`；Task 1 `normalizeTagInputs/normalizeTagName`。
- Produces:

```ts
ensureTags(env: Env, names: string[]): Promise<TagRecord[]>
replaceNodeDirectTags(env: Env, nodeId: string, names: string[]): Promise<TagRecord[]>
replaceSourceTags(env: Env, sourceId: string, names: string[]): Promise<TagRecord[]>
replaceProfileTagFilters(env: Env, profileId: string, names: string[]): Promise<TagRecord[]>
nodeTagViews(env: Env, nodeIds: string[]): Promise<Map<string, { direct: TagView[]; inherited: TagView[] }>>
profileFilterTagIds(env: Env, profileId: string): Promise<string[]>
```

- [ ] **Step 1: 实现 `worker/tag-store.ts`**

实现要求：

1. `ensureTags` 先调用 `normalizeTagInputs(names, names.length || 1)` 得到去重显示名。
2. 对每个名称执行 `INSERT OR IGNORE INTO tags`，ID 使用 `tag_${crypto.randomUUID()}`。
3. 插入后按 normalized name 分批（每批最多 90）查询，返回顺序必须与输入去重后的顺序一致。
4. `replace*` 使用 `env.DB.batch`：先 DELETE 目标关系，再 INSERT 新关系；空数组只执行 DELETE。
5. `nodeTagViews`：
   - direct 查询 `node_tags JOIN tags`；
   - inherited 查询 `source_nodes JOIN sources JOIN source_tags JOIN tags`，必须 `sources.enabled = true`；
   - 同一 Node 从多个 Source 继承同一 Tag 时按 tag ID 去重。
6. `profileFilterTagIds` 从 `profile_tag_filters` 返回 tag IDs。

不要把 SQL/Drizzle 查询逻辑复制到 routes/tasks；后续模块统一调用这里。

- [ ] **Step 2: 新增目录路由**

创建 `worker/routes/tags.ts`：

```ts
import { asc } from 'drizzle-orm'
import { Hono } from 'hono'
import { tags } from '../db'
import { ok } from '../http'
import { db } from '../tasks'

export const tagsRouter = new Hono<{ Bindings: Env }>()

tagsRouter.get('/', async (c) => {
  const rows = await db(c.env)
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .orderBy(asc(tags.normalizedName))
  return ok(c, rows)
})
```

- [ ] **Step 3: 注册路由**

在 `worker/app.ts`：

```ts
import { tagsRouter } from './routes/tags'
```

并在其他 authenticated API route 附近加入：

```ts
app.route('/api/tags', tagsRouter)
```

- [ ] **Step 4: 运行检查**

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add worker/tag-store.ts worker/routes/tags.ts worker/app.ts
git commit -m "feat: add tag catalog service"
```

---

### Task 4: 将 Node 写入、读取和筛选切换到关系表

**Files:**
- Modify: `worker/routes/nodes.ts`
- Modify: `worker/node-config.ts`
- Modify: `worker/tasks.ts`（仅移除/替换旧 tag helper 时）

**Interfaces:**
- Consumes: `ensureTags`, `replaceNodeDirectTags`, `nodeTagViews`, `mergeTagViews`。
- Produces: `GET /nodes` 支持 `tagId`；Node 响应新增 `directTags/inheritedTags`。

- [ ] **Step 1: Node create 双写**

在 `POST /nodes`：

1. `const directTagNames = normalizeTagInputs(input.tags, 10)`。
2. 创建 Node legacy `tags` 时使用 `directTagNames`，保持 `nodes.tags` 双写。
3. Node/source_nodes 创建成功后调用 `replaceNodeDirectTags(c.env, id, directTagNames)`。
4. 返回 Node 时不要只回显输入；调用 `nodeTagViews` 得到 direct/inherited，返回：

```ts
const effective = mergeTagViews(view.direct, view.inherited)
return {
  ...node,
  tags: effective.map((tag) => tag.name),
  directTags: view.direct,
  inheritedTags: view.inherited,
}
```

- [ ] **Step 2: Node import 双写**

`POST /nodes/import` 的 `input.tags` 统一通过 `normalizeTagInputs(input.tags, 10)`；legacy JSON 继续写入。批量节点创建后，对每个新 Node 建立 `node_tags` 关系。避免为每个 Node 重复创建 Tag：先调用一次 `ensureTags`，随后批量插入所有 `(node_id, tag_id)`。

- [ ] **Step 3: Node PATCH 只保存 direct tags**

编辑时：

1. 获取 `nodeTagViews(c.env, [id])`。
2. 建立 inherited normalized name set。
3. 对 `input.tags` 规范化后移除与 inherited 重复的名称。
4. legacy `nodes.tags` 写 direct name 数组。
5. 调用 `replaceNodeDirectTags` 替换关系。
6. 返回 direct/inherited/effective 三种视图。

服务器必须保留“即使客户端错误提交 inherited 标签，也不会把它复制成 direct 标签”的防御行为。

- [ ] **Step 4: Node GET/:id 和 GET / 切换读取**

删除 `nodeSourceTags + mergeNodeTags(node.tags, sourceTags)` 作为权威读取路径。批量获取当前页 Node IDs 后调用一次 `nodeTagViews`，避免 N+1。

输出保持：

```ts
tags: effective.map((tag) => tag.name)
directTags: view.direct
inheritedTags: view.inherited
```

- [ ] **Step 5: 增加 `tagId` SQL 过滤**

`GET /nodes` 读取：

```ts
const tagId = c.req.query('tagId')?.trim()
```

在现有 `and(...)` 中加入：

```ts
tagId
  ? sql`(
      EXISTS (
        SELECT 1 FROM node_tags nt
        WHERE nt.node_id = ${nodes.id} AND nt.tag_id = ${tagId}
      )
      OR EXISTS (
        SELECT 1
        FROM source_nodes sn
        JOIN sources s ON s.id = sn.source_id
        JOIN source_tags st ON st.source_id = s.id
        WHERE sn.node_id = ${nodes.id}
          AND s.enabled = 1
          AND st.tag_id = ${tagId}
      )
    )`
  : undefined,
```

确保 `nodes.ts` 导入 `sources/sourceTags` 仅在 Drizzle SQL 表达式需要；若使用 raw SQL 表名，不增加无用 import。

- [ ] **Step 6: 清理旧 helper 职责**

`worker/node-config.ts` 的 `nodeSourceTags` 如果已无调用则删除；`worker/tasks.ts` 的 `mergeNodeTags` 在 Task 6 完成 Profile 编译迁移前可暂留，但不得再被 Node route 使用。

- [ ] **Step 7: 运行检查**

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add worker/routes/nodes.ts worker/node-config.ts worker/tasks.ts
git commit -m "feat: use normalized tags for nodes"
```

---

### Task 5: Source 继承标签同步到 `source_tags`

**Files:**
- Modify: `worker/routes/sources.ts`

**Interfaces:**
- Consumes: `replaceSourceTags`。
- Produces: Source 的现有单个 `nodeTag` 同时存在于 `source_tags`，Node inherited 查询不依赖 legacy 字段。

- [ ] **Step 1: 创建 Source 时同步关系**

`POST /sources` 仍保存 legacy：

```ts
nodeTag: input.nodeTag || null
```

Source 插入成功后：

```ts
await replaceSourceTags(c.env, source.id, input.nodeTag ? [input.nodeTag] : [])
```

- [ ] **Step 2: 更新 Source 时同步关系**

`PATCH /sources/:id` 在现有 `nodeTag` 计算完成后继续写 legacy 字段，并在数据库更新成功后：

```ts
if (nodeTagChanged) await replaceSourceTags(c.env, current.id, nodeTag ? [nodeTag] : [])
```

保持现有行为：`enabled` 或 `nodeTag` 改变时仍 `enqueueAffectedProfiles`。

- [ ] **Step 3: 验证删除 cascade**

不新增手工 DELETE `source_tags`；依赖 FK cascade。检查 migration 中确实存在 `ON DELETE CASCADE`。

- [ ] **Step 4: 运行检查并提交**

```bash
pnpm test
pnpm lint
pnpm build
git add worker/routes/sources.ts
git commit -m "feat: sync source inherited tags"
```

---

### Task 6: Profile 标签过滤切换到关系表，保持 OR 语义

**Files:**
- Modify: `worker/routes/profiles.ts`
- Modify: `worker/tasks.ts`

**Interfaces:**
- Consumes: `replaceProfileTagFilters`, `profileFilterTagIds`, `nodeTagViews`, `matchesAnyTag`。
- Produces: 编译配置不再依赖 legacy JSON/source nodeTag 进行标签匹配。

- [ ] **Step 1: Profile create/update 双写 filter relation**

`POST /profiles`：

```ts
const filterNames = normalizeTagInputs(input.tags, 20)
```

legacy `profiles.tags` 写 `filterNames`；插入 Profile 后：

```ts
await replaceProfileTagFilters(c.env, profile.id, filterNames)
```

`PATCH /profiles/:id` 只有 `input.tags !== undefined` 时执行相同同步。不要用 truthy 判断，因为 `[]` 表示明确清空过滤条件。

- [ ] **Step 2: 重写 `selectProfileNodes` 标签匹配**

保留现有 Source Scope、enabled 节点、enabled Source、position 排序和节点去重逻辑，但删除：

```ts
const tags = mergeNodeTags(node.tags, [node.sourceTag])
if (profile.tags.length && !profile.tags.some((tag) => tags.includes(tag))) continue
```

改为：

```ts
const filterTagIds = await profileFilterTagIds(env, profile.id)
const nodeIds = [...new Set(selected.map((node) => node.id))]
const views = await nodeTagViews(env, nodeIds)

for (const node of selected) {
  const view = views.get(node.id) || { direct: [], inherited: [] }
  const effectiveTagIds = mergeTagViews(view.direct, view.inherited).map((tag) => tag.id)
  if (!matchesAnyTag(effectiveTagIds, filterTagIds)) continue
  if (!unique.has(node.id)) unique.set(node.id, node)
}
```

同时从 selected SQL projection 中删除不再需要的 `nodes.tags`、`sources.nodeTag` 字段。

- [ ] **Step 3: 删除不再使用的 `mergeNodeTags`**

全仓搜索：

```bash
rg "mergeNodeTags|nodeSourceTags" worker src tests
```

如果无调用，删除旧 helper 和相关 imports。不得删除 legacy DB columns。

- [ ] **Step 4: 添加 OR 语义回归测试**

Task 1 已覆盖纯函数 `matchesAnyTag`。这里运行：

```bash
pnpm vitest run tests/tag-model.test.ts
pnpm test
pnpm build
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add worker/routes/profiles.ts worker/tasks.ts
git commit -m "feat: normalize profile tag filters"
```

---

### Task 7: 新增前端 Tag 类型与 Creatable MultiSelect

**Files:**
- Modify: `src/api/types.ts`
- Create: `src/components/tag-multi-select.tsx`

**Interfaces:**
- Produces:

```ts
export type TagOption = { id: string; name: string }
```

组件：

```ts
type TagMultiSelectProps = {
  id: string
  value: string[]
  options: TagOption[]
  inherited?: TagOption[]
  max: number
  allowCreate?: boolean
  placeholder?: string
  onChange: (value: string[]) => void
  onBlur?: () => void
}
```

- [ ] **Step 1: 更新 API 类型**

在 `src/api/types.ts` 增加 `TagOption`，并在 `NodeItem` 增加：

```ts
directTags: TagOption[]
inheritedTags: TagOption[]
```

保留 `tags: string[]`。

- [ ] **Step 2: 实现 `TagMultiSelect`**

组件必须复用现有 `Popover`/`Input`/`Badge`/`Button`，不得新增依赖。

行为要求：

1. Trigger 区域展示 direct `value` Badge；每个 Badge 有删除按钮。
2. `inherited` 显示独立不可删除 Badge，视觉上使用 `variant="secondary"`，title/辅助文本为“来源继承”。
3. Popover 内有搜索 Input。
4. options 按输入字符串进行 case-insensitive includes 过滤。
5. 已选择 option 不重复显示或显示为已选状态，点击时 toggle。
6. `allowCreate !== false` 且输入 trim 后：
   - normalized 后不存在于 options；
   - normalized 后不存在于 value；
   - value.length < max；
   则显示按钮 `创建「${trimmed}」`。
7. 点击创建只执行 `onChange([...value, trimmed])`；不得调用 `/tags` POST，因为系统没有标签独立创建接口。
8. `allowCreate={false}` 时完全不显示创建入口。
9. `value.length >= max` 时禁用未选择项和创建入口，显示 `最多选择 ${max} 个标签`。
10. 删除/选择后维持去重；比较使用与后端相同的 ASCII lowercase + trim 逻辑，可在组件内放一个小的前端 helper，或新建共享 `src/lib/tags.ts`，但不要从 Worker 文件跨运行时 import。

- [ ] **Step 3: 构建验证**

项目未安装 React Testing Library，本任务不新增测试依赖。使用 TypeScript/build 作为组件静态验证：

```bash
pnpm lint
pnpm build
```

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add src/api/types.ts src/components/tag-multi-select.tsx
git commit -m "feat: add creatable tag multi select"
```

---

### Task 8: Node 新增/编辑表单接入多标签组件

**Files:**
- Modify: `src/features/nodes/node-dialogs.tsx`

**Interfaces:**
- Consumes: `TagMultiSelect`, `TagOption`, `NodeItem.directTags/inheritedTags`。
- Produces: Node 表单内部 `tags` 从 comma string 改为 `string[]`。

- [ ] **Step 1: 把 `tagsSchema` 改为数组 schema**

替换现有 comma string schema：

```ts
const tagsSchema = z
  .array(z.string().trim().min(1, '标签不能为空').max(24, '单个标签不能超过 24 个字符'))
  .max(10, '标签不能超过 10 个')
```

- [ ] **Step 2: `AddNodeDialog` 加载标签目录**

在 dialog 内：

```ts
const { data: tagOptions = [] } = useApi<TagOption[]>('/tags')
```

`defaultValues.tags` 改为 `[] as string[]`。

提交时直接：

```ts
tags: value.tags
```

删除所有 `.split(',')` 逻辑。

- [ ] **Step 3: 新增节点表单替换 Input**

替换 `manual-tags` Input：

```tsx
<TagMultiSelect
  id="manual-tags"
  value={field.state.value}
  options={tagOptions}
  max={10}
  placeholder="选择或创建标签"
  onBlur={field.handleBlur}
  onChange={field.handleChange}
/>
```

- [ ] **Step 4: `NodeEditor` 只编辑 direct tags**

默认值：

```ts
tags: node.directTags.map((tag) => tag.name)
```

不要使用 `node.tags`，因为它包含 inherited。

组件：

```tsx
<TagMultiSelect
  id="node-tags"
  value={field.state.value}
  options={tagOptions}
  inherited={node.inheritedTags}
  max={10}
  placeholder="选择或创建标签"
  onBlur={field.handleBlur}
  onChange={field.handleChange}
/>
```

提交直接发送 `tags: value.tags`。

- [ ] **Step 5: 回归检查**

确认 YAML/Form 两种 Node 编辑模式都仍可修改标签；订阅管理节点即使不可改连接，也能修改 direct 标签。

Run:

```bash
pnpm lint
pnpm build
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/features/nodes/node-dialogs.tsx
git commit -m "feat: use multi select for node tags"
```

---

### Task 9: Node 列表增加标签 Select 筛选

**Files:**
- Modify: `src/features/nodes/page.tsx`

**Interfaces:**
- Consumes: `GET /tags`, `GET /nodes?tagId=`。
- Produces: 工具栏第三个过滤维度。

- [ ] **Step 1: 增加 state 和目录请求**

```ts
const [tagId, setTagId] = useState('')
const { data: tags = [] } = useApi<TagOption[]>('/tags')
```

Node 请求改为：

```ts
`/nodes?page=${page}&pageSize=50&protocol=${protocol}&enabled=${enabled}&tagId=${tagId}`
```

- [ ] **Step 2: 在 toolbar 最前或协议筛选旁增加 Select**

```tsx
<Select
  value={tagId || 'all'}
  onValueChange={(value) => {
    setTagId(value === 'all' ? '' : value)
    setPage(1)
    setSelected([])
  }}
>
  <SelectTrigger>
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectItem value="all">全部标签</SelectItem>
      {tags.map((tag) => (
        <SelectItem key={tag.id} value={tag.id}>
          {tag.name}
        </SelectItem>
      ))}
    </SelectGroup>
  </SelectContent>
</Select>
```

切换 protocol/enabled 时也建议清空 `selected`，避免跨过滤结果保留不可见选中项。

- [ ] **Step 3: 手工验收标签来源语义**

准备三个节点：

```text
A: direct=高速
B: inherited=香港
C: direct=游戏, inherited=香港
```

验证：

```text
筛选 高速 -> 只有 A
筛选 香港 -> B + C
筛选 游戏 -> 只有 C
全部标签 -> A + B + C
```

- [ ] **Step 4: 静态检查并提交**

```bash
pnpm lint
pnpm build
git add src/features/nodes/page.tsx
git commit -m "feat: filter nodes by tag"
```

---

### Task 10: Profile 标签筛选改为现有标签多选

**Files:**
- Modify: `src/features/profiles/profile-dialog.tsx`

**Interfaces:**
- Consumes: `TagMultiSelect` with `allowCreate={false}`、`GET /tags`。
- Produces: Profile 不再依赖逗号手输标签，避免拼写出不存在的 filter。

- [ ] **Step 1: 加载目录并修改表单值类型**

```ts
const { data: tagOptions = [] } = useApi<TagOption[]>('/tags')
```

默认：

```ts
tags: profile?.tags || []
```

validator：

```ts
tags: z
  .array(z.string().trim().min(1).max(24))
  .max(20, '标签不能超过 20 个')
```

- [ ] **Step 2: 替换标签筛选 Input**

```tsx
<TagMultiSelect
  id="profile-tags"
  value={field.state.value}
  options={tagOptions}
  max={20}
  allowCreate={false}
  placeholder="选择节点标签；留空表示不过滤"
  onBlur={field.handleBlur}
  onChange={field.handleChange}
/>
```

提交直接发送 `tags: value.tags`。

- [ ] **Step 3: 验证 OR 语义不变**

Profile 选择 `[香港, 日本]` 时，生成配置应包含：

```text
拥有香港标签的节点
OR
拥有日本标签的节点
```

不得改成 AND。

- [ ] **Step 4: 运行检查并提交**

```bash
pnpm test
pnpm lint
pnpm build
git add src/features/profiles/profile-dialog.tsx
git commit -m "feat: select profile tag filters"
```

---

### Task 11: 全量兼容性、迁移和质量验证

**Files:**
- Modify only if verification exposes defects; do not add unrelated refactors.

**Interfaces:**
- Consumes: Tasks 1-10 完整实现。
- Produces: 可部署版本。

- [ ] **Step 1: 检查 legacy 字段仍存在**

```bash
rg "tags: text\('tags'|nodeTag: text\('node_tag'" worker/db.ts
```

Expected: `nodes.tags`、`profiles.tags`、`sources.nodeTag` 仍存在。

- [ ] **Step 2: 检查 Node/Profile UI 已无 comma tag parsing**

```bash
rg "split\(','\).*tag|join\(', '\)" src/features/nodes src/features/profiles
```

Expected: 标签表单路径不再通过 comma string 解析；其他非标签用途若命中需人工确认，不要机械删除。

- [ ] **Step 3: 检查旧权威读取 helper 已清理**

```bash
rg "mergeNodeTags|nodeSourceTags" worker
```

Expected: 无结果；若仍存在，只允许是明确兼容注释，不允许成为 Node/Profile 实际读取路径。

- [ ] **Step 4: 本地数据库一致性检查**

```bash
pnpm db:migrate:local
pnpm exec wrangler d1 execute DB --local --command "SELECT count(*) AS orphan_node_tags FROM node_tags nt LEFT JOIN nodes n ON n.id=nt.node_id LEFT JOIN tags t ON t.id=nt.tag_id WHERE n.id IS NULL OR t.id IS NULL;"
pnpm exec wrangler d1 execute DB --local --command "SELECT count(*) AS orphan_source_tags FROM source_tags st LEFT JOIN sources s ON s.id=st.source_id LEFT JOIN tags t ON t.id=st.tag_id WHERE s.id IS NULL OR t.id IS NULL;"
pnpm exec wrangler d1 execute DB --local --command "SELECT count(*) AS orphan_profile_filters FROM profile_tag_filters pt LEFT JOIN profiles p ON p.id=pt.profile_id LEFT JOIN tags t ON t.id=pt.tag_id WHERE p.id IS NULL OR t.id IS NULL;"
```

Expected: 三个 orphan count 均为 0。

- [ ] **Step 5: 全量质量命令**

```bash
pnpm test
pnpm lint
pnpm format:check
pnpm build
```

Expected: 全部退出码 0。

若 `format:check` 失败，只对本次修改文件运行项目 formatter：

```bash
pnpm format
pnpm format:check
```

然后重新运行 `pnpm test && pnpm lint && pnpm build`。

- [ ] **Step 6: 手工验收清单**

逐项确认：

```text
[ ] 新建手动 Node：可选择多个已有标签。
[ ] 新建手动 Node：输入不存在标签后显示“创建”，保存后出现在 /api/tags。
[ ] 同一表单输入 HK 与 hk：只保存一个 normalized tag。
[ ] 编辑 Node：direct 标签可删除；inherited 标签可见但不可删除。
[ ] 订阅 Source 的 nodeTag 仍能作为 Node inherited tag 生效。
[ ] Node 表格仍显示 effective tags，而不是只显示 direct tags。
[ ] Node 标签筛选能命中 direct 标签。
[ ] Node 标签筛选能命中 enabled Source inherited 标签。
[ ] 禁用 Source 后，其 inherited 标签不再参与 Node 筛选和 Profile 过滤。
[ ] Profile 空标签筛选仍包含所有符合 Source Scope 的 enabled Node。
[ ] Profile 多标签筛选保持 OR。
[ ] 删除 Node/Source/Profile 后关系表无孤儿行。
[ ] 未使用 Tag 仍保留在 tags 目录中。
[ ] 旧 nodes.tags/source.node_tag/profiles.tags 同步更新，可用于回滚旧版本代码。
```

- [ ] **Step 7: 最终提交**

如果验证阶段有修复：

```bash
git add -A
git commit -m "fix: complete tag system integration"
```

若没有额外修改，不创建空提交。

---

## Explicit Non-Goals

本次不要实现以下内容：

- 不新增独立“标签管理”页面。
- 不新增 Tag 重命名、删除、颜色、自定义排序 API。
- 不把 Source UI 扩展为多标签；`source_tags` 仅做底层未来兼容。
- 不删除 legacy 标签字段。
- 不修改 Node 最大数量、Source 最大数量、Profile 最大数量。
- 不改变 Profile 标签过滤 OR 语义。
- 不引入 React Testing Library、Combobox 第三方库或任何新 npm 依赖。
- 不对与标签无关的 Node/Source/Profile 代码做重构。

## Rollback Contract

由于 legacy 字段继续双写，若新版本上线后需要回滚应用代码：

1. 不回滚 `0001_normalize_tags.sql`；新增表保留不会影响旧代码。
2. 回滚到旧应用代码后，旧代码继续读取 `nodes.tags`、`sources.node_tag`、`profiles.tags`。
3. 在新版本稳定前，不允许部署任何删除 legacy columns 的 migration。
4. Source 仍只有单个继承标签，因此 legacy `source.node_tag` 能完整表达本版本 Source 标签语义。

## Definition of Done

只有同时满足以下条件才视为完成：

```text
1. 数据库存在 tags/node_tags/source_tags/profile_tag_filters 且已有数据完成 backfill。
2. 新 Node 标签可“已有即选中、不存在即作为待创建项”，保存后落入 Tag Catalog。
3. Node 编辑明确区分 direct 与 inherited 标签。
4. GET /api/tags 可返回标签目录。
5. GET /api/nodes?tagId=... 可筛 direct + inherited 标签。
6. Profile 编译通过关系表执行 OR 标签过滤。
7. Source 单继承标签同步到 source_tags。
8. legacy 字段持续双写且未删除。
9. pnpm test / lint / format:check / build 全部通过。
10. 手工验收清单全部通过。
```
