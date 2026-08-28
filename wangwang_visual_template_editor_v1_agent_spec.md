# Wangwang 订阅模板可视化编辑器 V1 技术实施规格

> 目标：交给 Coding Agent 后可直接按本文档实现，不需要重新做产品/架构决策。
>
> 基线：2026-08-28 `linct96/wangwang` 的 `main` 分支公开代码结构。Agent 开始编码前必须以本地仓库当前代码为最终事实；若与本文档有差异，应保留本文档的产品约束并适配当前实现，不得机械覆盖新代码。

## 0. Agent 执行契约（必须先读）

### 0.1 最终目标

在现有“新建/编辑模板”页面增加 **可视化编辑 / YAML 编辑** 双模式。V1 只对以下内容提供结构化编辑：

- `proxy-groups`
- `rules`

YAML 仍然是模板的唯一持久化格式和 API 传输格式；不新增数据库字段，不设计第二套模板 JSON 存储协议。

### 0.2 硬性约束（MUST）

1. **不得修改模板数据库模型。**
2. **不得把 VisualDraft 持久化到 API 或 D1。** 保存仍提交 `{ name, description, yaml }`。
3. **不得重建整个 YAML 根对象。** 可视化编辑只修改 `proxy-groups` 与 `rules`，根级其他字段必须保留。
4. **不得静默丢弃未知配置。** 不支持的规则、代理组类型、代理组额外字段必须保留。
5. **不得用 `split(',')` 解析所有 Mihomo rules。** 只解析本文明确支持的简单规则；其余一律 RAW 保留。
6. **不得引入 React Flow。** V1 不是节点图编辑器。
7. **V1 不强制新增拖拽依赖。** rules 和 group members 的排序必须支持“上移/下移”；如当前仓库已经有可访问排序能力才可复用。
8. **不得把 Worker 的 `parseTemplateYaml` 直接搬到前端作为唯一校验。** 前端需要可视化语义校验，Worker 校验仍作为最终校验。
9. **不得因为可视化能力不足而阻止用户回到 YAML 模式。**
10. **不得自动改写 RAW 高级规则的内容。**
11. **所有现有预览、保存、内置模板复制、导入能力必须继续工作。**
12. 代码完成后必须执行：`pnpm lint`、`pnpm build`、`pnpm test`（按本文新增测试脚本）。

### 0.3 非目标（V1 不做）

- `rule-providers` / `RULE-SET` 的完整可视化。
- `AND` / `OR` / `NOT` 等逻辑规则图形化。
- `load-balance` 等全部 Mihomo group 类型的创建表单。
- React Flow、连线画布、拓扑图。
- 自动解析/编辑 DNS、TUN、sniffer 等根级字段。
- 模板 schema 版本化或数据库迁移。

---

## 1. 当前项目基线与可复用链路

当前实现已经适合在前端增加“结构化编辑层”，无需改造后端存储链路。

| 位置                                          | 当前职责                                                  | V1 处理方式                           |
| --------------------------------------------- | --------------------------------------------------------- | ------------------------------------- |
| `src/features/templates/editor.tsx`           | `yaml` 字符串状态、导入、校验、保存、CodeMirror、右侧预览 | 保留为主容器，新增 mode + VisualDraft |
| `src/features/templates/template-preview.tsx` | POST `/templates/preview`，展示最终配置                   | 原样复用，继续接收当前 `yaml`         |
| `worker/templates/validator.ts`               | YAML 解析、模板结构校验、占位符校验                       | 原样保留，作为服务端最终校验          |
| `worker/templates/renderer.ts`                | 注入真实节点，展开全部节点占位符，输出 Mihomo YAML        | 原样保留                              |
| `worker/templates/builtin.ts`                 | 精简/全规则模板                                           | 必须可被 Visual Adapter 正确解析      |
| `worker/routes/templates.ts`                  | 创建、更新、validate、preview API                         | V1 原则上不修改                       |
| `src/api/types.ts`                            | `TemplateDetail = ... & { yaml: string }`                 | 不增加 visual schema                  |
| `src/styles/templates.css`                    | 当前模板页双栏布局和 CodeMirror/preview 样式              | 在此继续补充 visual 样式              |
| `package.json`                                | 已有 `yaml` 2.x，无测试脚本                               | 新增 Vitest 作为唯一必要测试依赖      |

当前特殊占位符：

```text
__WANGWANG_ALL_PROXIES__
```

它只能作为 `proxy-groups[*].proxies` 的成员存在，最终由 Worker renderer 展开为订阅中的真实节点名。可视化 UI 不直接展示该内部字符串，而显示“全部节点（订阅动态注入）”。

---

## 2. 产品行为定义

### 2.1 双模式

在模板内容区域增加：

```text
[ 可视化编辑 ] [ YAML 编辑 ]
```

优先复用现有 `src/components/ui/segmented.tsx`。

默认模式：

- `source === 'blank'`：默认 `visual`
- `source === 'builtin:minimal' | 'builtin:full'`：加载完成且解析成功后默认 `visual`
- `source === 'import'`：默认 `yaml`，用户导入后可主动切换 visual
- 编辑已有自定义模板 `id`：默认 `yaml`，用户主动切换 visual

理由：新建流程突出可视化能力；已有高级 YAML 不应被自动带入结构化模式造成误解。

### 2.2 YAML → Visual 切换

点击“可视化编辑”时：

1. 使用 `parseDocument()` 解析当前 `yaml`。
2. YAML 语法错误：保持 YAML 模式，显示错误，不清空用户内容。
3. 根节点不合法或 `proxy-groups` 无法结构化读取：保持 YAML 模式并提示原因。
4. 存在不支持的 group/rule：允许进入 Visual，但将其显示为“高级/RAW”只读项，并显示非阻塞提示。
5. 解析成功后生成新的 `VisualTemplateDraft`。

### 2.3 Visual → YAML 切换

任何时候都允许切回 YAML。Visual 的每一次修改都必须同步更新当前 `yaml`，因此切换时不需要二次“生成”或“确认覆盖”。

### 2.4 保存与校验

- YAML 模式：维持现有行为。
- Visual 模式：先执行本地语义校验；存在 blocking error 时禁用保存并显示错误摘要。
- 点击“校验”仍调用现有 `POST /templates/validate`。
- 保存仍调用现有 POST/PATCH templates API。
- 右侧 `TemplatePreview` 始终收到当前 `yaml`，无需理解 VisualDraft。

---

## 3. 总体架构

```text
                  ┌──────────────────────┐
                  │ TemplateEditor       │
                  │ canonical: yaml      │
                  └──────────┬───────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
        YAML mode                      Visual mode
        CodeMirror                    VisualDraft
              │                             │
              │                     local validation
              │                             │
              │                     applyVisualTemplate()
              │                             │
              └──────────────► yaml ◄───────┘
                             │
                   validate / preview / save
                             │
                    existing Worker APIs
```

核心原则：

- `yaml` 是 canonical state。
- `visualDraft` 是编辑会话状态，不持久化。
- YAML 模式修改后，旧 VisualDraft 视为失效；下次进入 visual 必须重新 parse。
- Visual 模式修改后，立即 patch 当前 YAML，并 `setYaml(nextYaml)`。

推荐 `TemplateEditor` 状态：

```ts
type EditorMode = 'visual' | 'yaml'

const [mode, setMode] = useState<EditorMode>(...)
const [yaml, setYaml] = useState(...)
const [visualDraft, setVisualDraft] = useState<VisualTemplateDraft | null>(null)
const [visualIssues, setVisualIssues] = useState<VisualIssue[]>([])
```

禁止把 `visualDraft` 设为唯一真源；否则 YAML 导入、高级字段和未知配置会变得难以无损处理。

---

## 4. 文件改动规划

建议最终结构：

```text
src/features/templates/
├── editor.tsx                         # 修改：双模式与状态编排
├── template-preview.tsx               # 原则上不改
└── visual/
    ├── model.ts                       # VisualDraft 类型
    ├── yaml-adapter.ts                # YAML <-> VisualDraft（核心）
    ├── validation.ts                  # 本地语义校验/引用分析
    ├── visual-editor.tsx              # visual 总容器
    ├── proxy-groups-editor.tsx        # group 列表
    ├── proxy-group-dialog.tsx         # 新增/编辑 group
    ├── rules-editor.tsx               # rule 列表与排序
    ├── rule-dialog.tsx                # 新增/编辑 rule
    ├── yaml-adapter.test.ts            # adapter 单测
    └── validation.test.ts              # 引用/循环/规则校验单测

src/styles/templates.css                # 修改：visual 样式
package.json                            # 修改：vitest + test script
```

若实现过程中某两个小组件明显可以合并，可合并；但 `model.ts`、`yaml-adapter.ts`、`validation.ts` 必须保持独立，不能全部堆入 `editor.tsx`。

---

## 5. Visual 数据模型（必须按“支持 + RAW”设计）

### 5.1 模板根模型

```ts
export type VisualTemplateDraft = {
  groups: ProxyGroupDraft[]
  rules: RuleDraft[]
}
```

### 5.2 Proxy Group

```ts
export type SupportedProxyGroupType = 'select' | 'url-test' | 'fallback'

export type ProxyGroupMemberDraft =
  | { kind: 'all-proxies' }
  | { kind: 'group'; groupId: string }
  | { kind: 'builtin'; value: 'DIRECT' | 'REJECT' }
  | { kind: 'raw'; value: string }

export type StructuredProxyGroupDraft = {
  kind: 'structured'
  id: string
  name: string
  type: SupportedProxyGroupType
  members: ProxyGroupMemberDraft[]
  url?: string
  interval?: number
  tolerance?: number
  extras: Record<string, unknown>
}

export type RawProxyGroupDraft = {
  kind: 'raw'
  id: string
  name: string
  type: string
  raw: Record<string, unknown>
}

export type ProxyGroupDraft = StructuredProxyGroupDraft | RawProxyGroupDraft
```

规则：

- `id` 只存在于前端会话，不写入 YAML。
- group YAML 引用最终仍按 name 序列化。
- `extras` 必须保存支持类型中未被 Visual UI 管理的字段，例如未来出现的高级参数。
- 不支持的 type 整个 group 进入 `kind: 'raw'`，Visual 中只读展示，可删除/查看，但编辑需切 YAML。
- `raw` member 用于保留无法映射到占位符、builtin 或现有 group 的字符串。

### 5.3 Rules

V1 结构化支持：

```text
DOMAIN
DOMAIN-SUFFIX
DOMAIN-KEYWORD
GEOSITE
GEOIP
IP-CIDR
IP-CIDR6
MATCH
```

数据结构：

```ts
export type SupportedRuleType =
  'DOMAIN' | 'DOMAIN-SUFFIX' | 'DOMAIN-KEYWORD' | 'GEOSITE' | 'GEOIP' | 'IP-CIDR' | 'IP-CIDR6' | 'MATCH'

export type RuleTargetDraft =
  { kind: 'group'; groupId: string } | { kind: 'builtin'; value: 'DIRECT' | 'REJECT' } | { kind: 'raw'; value: string }

export type StructuredRuleDraft = {
  kind: 'structured'
  id: string
  type: SupportedRuleType
  value?: string
  target: RuleTargetDraft
  noResolve: boolean
}

export type RawRuleDraft = {
  kind: 'raw'
  id: string
  raw: string
}

export type RuleDraft = StructuredRuleDraft | RawRuleDraft
```

RAW 规则示例：

```text
RULE-SET,my-provider,节点选择
AND,((NETWORK,UDP),(DST-PORT,443)),REJECT
```

Visual UI 不尝试拆解它们，不自动改写。

---

## 6. YAML Adapter 设计（本功能最高优先级）

### 6.1 API

`yaml-adapter.ts` 至少暴露：

```ts
export type VisualParseResult = {
  draft: VisualTemplateDraft
  warnings: VisualIssue[]
}

export function parseVisualTemplate(yamlText: string): VisualParseResult

export function applyVisualTemplate(yamlText: string, draft: VisualTemplateDraft): string
```

允许再拆内部 helper，但 UI 不应直接操作 YAML AST。

### 6.2 必须使用 `parseDocument()`

项目已有 `yaml` 2.x。使用 Document API，而不是：

```ts
parse(yaml) -> plain object -> stringify(all)
```

推荐：

```ts
import { parseDocument } from 'yaml'

const doc = parseDocument(yamlText, { maxAliasCount: 20 })
```

原因：Document 方式更适合在根级保留不相关字段与注释，并让 adapter 只替换受管理节点。

### 6.3 Patch 边界

`applyVisualTemplate()` 只允许修改：

```text
proxy-groups
rules
```

不得主动重写：

```text
mixed-port
allow-lan
mode
log-level
ipv6
dns
tun
sniffer
rule-providers
任何未知根字段
```

保证目标是“语义无损”。对于 `proxy-groups` / `rules` 内部的注释和原始排版属于 best-effort，不要求字节级保持；但未知字段和值必须保留。

### 6.4 Group 解析算法

1. 读取 `proxy-groups` 为 sequence。
2. 先扫描所有 group 的 `name`，为每组生成 runtime `id`，建立 `name -> id`。
3. 第二遍解析：
   - type 为 `select | url-test | fallback`：生成 structured。
   - 其余 type：生成 raw。
4. structured group 的 known keys：
   - `name`
   - `type`
   - `proxies`
   - `url`
   - `interval`
   - `tolerance`
5. 除 known keys 外的所有键进入 `extras`。
6. `proxies` 成员映射优先级：
   - 等于 `__WANGWANG_ALL_PROXIES__` → `all-proxies`
   - 等于 `DIRECT` / `REJECT` → builtin
   - 等于已有 group name → groupId
   - 其他字符串 → raw member

### 6.5 Group 序列化算法

structured group：

1. 先复制 `extras`。
2. 再写 known keys，known keys 永远覆盖 extras 中的同名键。
3. member 序列化：
   - all-proxies → `__WANGWANG_ALL_PROXIES__`
   - group → 根据 groupId 查当前 name
   - builtin → 原值
   - raw → 原值
4. `select` 不主动写入 url/interval/tolerance。
5. `url-test` 写 `url`、`interval`，有 tolerance 时写 tolerance。
6. `fallback` 写 `url`、`interval`，不由 UI 创建 tolerance；如果原文件中 tolerance 位于 extras，必须保留。
7. raw group 直接使用原 `raw` 对象，不做格式猜测。

### 6.6 Rule 解析算法

只对明确简单格式做结构化转换。不要创建“通用逗号语法 parser”。

可结构化条件：

- `MATCH,target`：恰好 2 个语义字段。
- `DOMAIN|DOMAIN-SUFFIX|DOMAIN-KEYWORD|GEOSITE,typeValue,target`：3 个字段。
- `GEOIP|IP-CIDR|IP-CIDR6,value,target[,no-resolve]`：3 或 4 个字段，第四个仅接受 `no-resolve`。

任何以下情况直接 RAW：

- 类型不在支持列表。
- token 数量不符合上面定义。
- 出现无法确定含义的附加 token。
- compound rule / provider rule。

Target 映射：

- 命中 group name → groupId
- `DIRECT` / `REJECT` → builtin
- 其他 → raw target（保留，不强制报错）

### 6.7 Rule 序列化

- structured rule 根据字段重新生成标准逗号字符串。
- raw rule 必须原字符串返回。
- `MATCH` 只输出 `MATCH,<target>`。
- `no-resolve` 只允许 GEOIP/IP-CIDR/IP-CIDR6 输出。

### 6.8 RAW 引用安全

结构化引用使用 groupId，因此 group rename 后自然更新。

但 RAW rule / raw group 可能包含 group name，不能盲目替换。实现 `findPotentialRawReferences(draft, groupName)`：

- raw rule：仅在 groupName 作为逗号分隔的完整 token 出现时视为潜在引用。
- raw group：递归扫描 raw 对象，任意字符串值与 groupName 完全相等时视为潜在引用。

若存在潜在 RAW 引用：

- **禁止在 Visual 中重命名该 group。**
- **禁止在 Visual 中删除该 group。**
- 提示：“该代理组可能被高级配置引用，请切换到 YAML 编辑后处理。”

不要尝试自动改写复杂 RAW 文本。

---

## 7. Proxy Groups 可视化 UI

### 7.1 列表

建议布局：

```text
代理组                                      + 添加代理组

┌ 节点选择                                      select ┐
│ 成员：自动选择 · 故障转移 · 全部节点 · DIRECT       │
│                                      [编辑] [删除] │
└──────────────────────────────────────────────────┘

┌ 自动选择                                    url-test ┐
│ 全部节点 / 300s / tolerance 50                     │
│                                      [编辑] [删除] │
└──────────────────────────────────────────────────┘
```

RAW group：

```text
┌ 高级代理组                                    load-balance ┐
│ 当前版本不支持可视化修改，请使用 YAML 编辑。                │
│                                                [查看] [删除] │
└────────────────────────────────────────────────────────────┘
```

### 7.2 新增/编辑 Dialog

类型仅允许：

- `select`
- `url-test`
- `fallback`

字段：

| 字段      | select | url-test | fallback |
| --------- | -----: | -------: | -------: |
| 名称      |     ✅ |       ✅ |       ✅ |
| 成员      |     ✅ |       ✅ |       ✅ |
| 测试 URL  |      — |       ✅ |       ✅ |
| interval  |      — |       ✅ |       ✅ |
| tolerance |      — |       ✅ |        — |

新增默认值：

- select：members = `[all-proxies]`
- url-test：url = `https://www.gstatic.com/generate_204`，interval = 300，tolerance = 50，members = `[all-proxies]`
- fallback：url 同上，interval = 300，members = `[all-proxies]`

新增 group 名称必须通过 `uniqueName(base, groups)` 避免直接生成重名。

### 7.3 成员选择器

可新增的选项：

1. 全部节点（订阅动态注入）
2. DIRECT
3. REJECT
4. 其他现有 proxy group（排除自己）

导入产生的 raw member 可以显示和删除，但 V1 不提供“新增任意 raw member”入口。

成员顺序支持：

- 上移
- 下移
- 删除

### 7.4 Rename / Delete

Rename：

- structured references 使用 groupId，无需逐字符串修改。
- 若潜在 RAW 引用存在，阻止 rename。

Delete：

- 若被任何 structured group member 引用：阻止。
- 若被任何 structured rule target 引用：阻止。
- 若存在潜在 RAW 引用：阻止。
- 错误文案要给出引用数量，例如“该代理组被 2 个代理组和 7 条规则引用”。

不实现 force delete。

---

## 8. Rules 可视化 UI

### 8.1 列表表现

```text
规则                                             + 添加规则

↑ ↓  GEOSITE       category-ads-all       → REJECT       [编辑] [删除]
↑ ↓  GEOIP         private                → DIRECT       no-resolve
↑ ↓  GEOSITE       cn                     → DIRECT
↑ ↓  GEOIP         CN                     → DIRECT       no-resolve
↑ ↓  MATCH                                → 节点选择
```

RAW：

```text
↑ ↓  高级规则  AND,((NETWORK,UDP),(DST-PORT,443)),REJECT  [删除]
```

RAW 规则 V1 不可在 Visual 内修改正文，但允许排序与删除。

### 8.2 新增/编辑 Dialog

字段：

- Rule type：Select
- Value：除 MATCH 外必填
- Target：Select
- `no-resolve`：仅 GEOIP/IP-CIDR/IP-CIDR6 显示 Checkbox

Target 可选：

- 所有 proxy groups（包括 RAW group，只要有合法 name）
- DIRECT
- REJECT

导入的 `raw target` 在编辑时应显示当前值和警告；若用户主动改选为合法 target，则转换为正常 target。

### 8.3 排序

V1 强制提供上移/下移，不新增排序库。

- 第一条“上移”disabled。
- 最后一条“下移”disabled。
- 调整后立即同步 YAML。

### 8.4 MATCH

Visual 创建规则时：

- 新增 MATCH 默认追加到最后。
- 如果已经存在 MATCH，禁止再次新增 MATCH，提示已有兜底规则。

导入 YAML 时：

- 若 MATCH 不在最后：只给 warning，不自动改变顺序。
- 若存在多个 MATCH：给 warning，不自动删除。

原则：对导入内容不做隐式语义修改。

---

## 9. 本地语义校验

`validation.ts` 输出统一结构：

```ts
export type VisualIssue = {
  level: 'error' | 'warning'
  code: string
  message: string
  groupId?: string
  ruleId?: string
}
```

### 9.1 Blocking errors

至少覆盖：

- group name 为空。
- group name 重复。
- supported group 无成员。
- group member 引用不存在的 groupId。
- structured rule target 引用不存在的 groupId。
- url-test/fallback URL 为空或不是合法 http/https URL。
- interval 不是正整数。
- url-test tolerance 不是非负整数。
- supported rule（MATCH 除外）value 为空。
- proxy group 结构化引用形成循环。

循环检测：把 structured group -> structured group member 建图，DFS 或三色标记；发现环时输出至少一条可读错误，如：

```text
代理组存在循环引用：A → B → C → A
```

### 9.2 Warnings

至少覆盖：

- 存在 RAW group。
- 存在 RAW rule。
- structured group 含 extras（提示高级字段会保留，但需 YAML 修改）。
- MATCH 不在最后。
- 多个 MATCH。
- raw target 无法映射到 group/DIRECT/REJECT。
- raw group 不参与完整循环引用分析。

Warning 不阻止保存。

---

## 10. `TemplateEditor` 接入方式

### 10.1 模式切换 helper

推荐把逻辑写成具名函数，不要塞进 JSX：

```ts
function enterVisualMode() {
  try {
    const result = parseVisualTemplate(yaml)
    setVisualDraft(result.draft)
    setVisualIssues(validateVisualDraft(result.draft, result.warnings))
    setMode('visual')
    setError('')
  } catch (reason) {
    setError(toMessage(reason, '无法进入可视化编辑'))
  }
}
```

YAML 编辑时：

```ts
onChange={(nextYaml) => {
  setYaml(nextYaml)
  setVisualDraft(null)
}}
```

### 10.2 Visual 更新 helper

```ts
function updateVisualDraft(nextDraft: VisualTemplateDraft) {
  const issues = validateVisualDraft(nextDraft)
  setVisualDraft(nextDraft)
  setVisualIssues(issues)
  setYaml((currentYaml) => applyVisualTemplate(currentYaml, nextDraft))
}
```

如果 adapter 在某次更新抛错：

- 不吞错误。
- 保留 draft 之前的可用状态。
- 在页面显示错误。
- 不覆盖当前 yaml。

实现时可先计算 `nextYaml`，成功后再一起 set state，以保证原子性。

### 10.3 Header 区域

把现有“YAML 内容”标题改为更通用的“模板内容”，旁边放 `Segmented`。

YAML 模式才显示：

- “格式化 YAML”按钮。
- CodeMirror。

Import 场景的“导入文件”仍保留；导入文件后只 `setYaml`，不自动强制切 visual。

Visual 模式显示 `<VisualTemplateEditor />`。

### 10.4 Save disabled

Visual 模式下：

```text
busy || !name.trim() || !yaml.trim() || hasVisualBlockingErrors
```

YAML 模式维持现有条件，最终错误由服务端校验返回。

---

## 11. 样式与交互要求

复用当前 shadcn/ui：

- `Button`
- `IconButton`
- `Dialog`
- `Input`
- `Select`
- `Checkbox`
- `Badge`
- `Alert`
- `Segmented`

不要引入第二套 UI 框架。

CSS 延续 `src/styles/templates.css` 的现有 `@scope`。新增类建议：

```text
.template-mode-switch
.template-visual-editor
.template-visual-section
.template-visual-toolbar
.template-visual-list
.template-visual-card
.template-visual-card-header
.template-visual-card-meta
.template-member-list
.template-rule-row
.template-rule-actions
.template-visual-issues
```

响应式要求：

- > 900px 保持当前“编辑器 + 预览”双栏。
- <=900px 继续单栏。
- visual 卡片内部按钮允许 wrap。
- 不依赖 hover 才能完成操作。
- Icon-only action 必须有 accessible label。

---

## 12. 测试策略

### 12.1 新增测试依赖

当前项目没有显式测试脚本。V1 新增：

```json
{
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "<与当前 Node/TS 兼容的稳定版本>"
  }
}
```

只为纯函数 adapter/validation 添加测试，不要求第一版引入 React component testing library。

### 12.2 Adapter 必测用例

1. **blank template parse**
   - `节点选择`
   - all-proxies placeholder
   - MATCH

2. **builtin minimal round-trip**
   - parse → apply 后再次 `parseDocument()` 成功。
   - DNS 等根字段仍存在。
   - 3 个 group 和原 rules 语义一致。

3. **builtin full round-trip**
   - AI/Google/Telegram 等 group 引用正确。
   - rules target 正确映射到 groupId 并回写 name。

4. **unknown root fields preserved**
   - 输入含 `tun`、`sniffer`、自定义 root key。
   - 修改一条 visual rule 后这些字段仍存在且值不变。

5. **supported group extras preserved**
   - select group 增加未知键 `foo: bar`。
   - 修改 group name 后 `foo` 仍存在。

6. **unsupported group preserved**
   - `load-balance` group 进入 raw。
   - 修改其他规则后 raw group 语义不变。

7. **raw rule exact preservation**
   - `AND,...` 或 `RULE-SET,...` 必须原字符串输出。

8. **rename structured reference**
   - A 被 group B 与 rule 引用。
   - 修改 A.name 后输出中 structured 引用全部使用新 name。

9. **raw reference protection**
   - raw rule 中完整 token 引用 A。
   - `findPotentialRawReferences` 能发现。

10. **placeholder only maps as member**
    - all-proxies 正确往返。

### 12.3 Validation 必测用例

- duplicate group name。
- missing member group。
- missing rule target group。
- A → B → A 循环。
- A → A 自引用。
- 三层循环路径输出。
- invalid url。
- invalid interval/tolerance。
- MATCH 非最后 warning。
- multiple MATCH warning。
- raw group/rule warning。

---

## 13. 人工验收场景（Agent 完成后逐项自测）

### A. 新建空白模板

1. 进入 `/app/templates/new?source=blank`。
2. 默认看到 Visual。
3. 能看到“节点选择”与 MATCH。
4. 新增“自动选择” url-test。
5. 将“自动选择”加入“节点选择”成员。
6. 新增 `GEOSITE,google,自动选择`。
7. 右侧生成预览成功。
8. 切换 YAML，内容正确。
9. 保存成功。

### B. 精简模板副本

1. 从 builtin:minimal 新建。
2. 默认 Visual。
3. 三个 group 全部正确识别。
4. `__WANGWANG_ALL_PROXIES__` 不直接暴露给用户。
5. 修改“节点选择”为“默认代理”。
6. 所有结构化 group/rule 引用同步变为“默认代理”。
7. DNS 内容没有被删除。
8. 预览成功。

### C. 全规则模板

- 所有 select group 可视化。
- AI/Google/Telegram 等规则 target 可选中对应 group。
- 重命名某策略组后关联规则同步。

### D. 高级 YAML 兼容

导入：

```yaml
mixed-port: 7890
custom-root:
  keep: true
proxy-groups:
  - name: 节点选择
    type: select
    foo: bar
    proxies:
      - __WANGWANG_ALL_PROXIES__
  - name: 高级均衡
    type: load-balance
    strategy: consistent-hashing
    proxies:
      - 节点选择
rules:
  - AND,((NETWORK,UDP),(DST-PORT,443)),REJECT
  - MATCH,节点选择
```

验收：

- 可以进入 Visual。
- “高级均衡”为 RAW group。
- AND 为 RAW rule。
- `foo: bar` 被保留。
- `custom-root.keep` 被保留。
- 修改 MATCH 前的其他 structured 内容后，RAW 内容仍存在。
- 若尝试重命名“节点选择”，因为 RAW group 可能引用它，Visual 应阻止并提示切 YAML。

### E. 删除保护

- group 被另一 group 引用时不能删除。
- group 被 rule 引用时不能删除。
- 被 RAW 潜在引用时不能删除。

---

## 14. 实施顺序（Agent 必须按此顺序）

### Phase 1：纯模型与 Adapter

1. 新建 `visual/model.ts`。
2. 实现 `yaml-adapter.ts`。
3. 新增 Vitest。
4. 写并跑 adapter tests。
5. 此阶段不要先写 UI。

**Phase 1 完成门槛：** builtin minimal/full 与高级 YAML 用例全部通过。

### Phase 2：Validation

1. 实现引用查询。
2. 实现 raw reference 检测。
3. 实现 cycle detection。
4. 实现 visual field validation。
5. 写 validation tests。

### Phase 3：Visual UI

1. Proxy groups list + dialog。
2. Member picker + 上下移动。
3. Rules list + dialog。
4. Rules 上下移动。
5. Issue summary。

### Phase 4：接入 Editor

1. 增加 mode。
2. 实现 YAML → Visual。
3. 实现 Visual → YAML 实时同步。
4. 保持 preview/save/validate 现有 API。
5. 处理 blank/builtin/import/edit 的默认 mode。

### Phase 5：回归与收尾

执行：

```bash
pnpm test
pnpm lint
pnpm build
```

然后完成本文第 13 节人工验收。

不要为了让 lint/build 通过而删除必要校验或使用大范围 `eslint-disable`/类型断言绕过问题。

---

## 15. Definition of Done

只有同时满足以下条件才算完成：

- [ ] 新建 blank/builtin 模板可用 Visual 完成 proxy-groups + rules 创建。
- [ ] YAML 编辑能力完整保留。
- [ ] Visual 与 YAML 可以双向切换。
- [ ] `yaml` 仍是唯一保存格式。
- [ ] 不需要数据库迁移。
- [ ] 不支持的 root 字段不丢失。
- [ ] supported group 的 extras 不丢失。
- [ ] unsupported group RAW 保留。
- [ ] unsupported rule RAW 原字符串保留。
- [ ] 全部节点占位符正确映射且 UI 不暴露内部字符串。
- [ ] group rename 能同步所有结构化引用。
- [ ] RAW 潜在引用存在时禁止危险 rename/delete。
- [ ] group delete 有引用保护。
- [ ] group cycle 能被本地校验发现。
- [ ] rules 可新增、编辑、删除、上移、下移。
- [ ] MATCH 创建约束和导入 warning 正确。
- [ ] 右侧 preview 正常。
- [ ] validate/save 正常。
- [ ] builtin:minimal / builtin:full adapter tests 通过。
- [ ] `pnpm test` 通过。
- [ ] `pnpm lint` 通过。
- [ ] `pnpm build` 通过。

---

## 16. 禁止的实现捷径

以下实现即使“看起来能用”也不接受：

```ts
// ❌ 1. 每次 visual 修改都 plain parse/stringify 整份 YAML
const config = parse(yaml)
config['proxy-groups'] = groups
setYaml(stringify(config))
```

原因：会无差别重写整个文档，未知配置和注释控制能力差。

```ts
// ❌ 2. 通用 split rules
const [type, value, target] = rule.split(',')
```

原因：复杂规则内部含逗号，必然误解析。

```ts
// ❌ 3. 只支持已知字段，序列化时直接 new object
return { name, type, proxies, url, interval }
```

原因：会丢失 supported group 的高级 extras。

```ts
// ❌ 4. rename 时对 YAML 做全局字符串 replace
setYaml(yaml.replaceAll(oldName, newName))
```

原因：会误改域名、注释、规则值和其他字符串。

```ts
// ❌ 5. Visual 模式有不支持项就拒绝进入
throw new Error('不支持高级规则')
```

原因：V1 的兼容策略是 RAW 保留，不是锁死高级用户。

---

## 17. Agent 最终交付说明格式

完成编码后，Agent 的最终回复必须包含：

1. **实现摘要**：做了哪些功能。
2. **文件清单**：新增/修改了哪些文件。
3. **关键设计说明**：YAML canonical、RAW 保留、rename/delete 保护如何实现。
4. **测试结果**：`pnpm test` / `pnpm lint` / `pnpm build` 的真实执行结果。
5. **人工验收结果**：第 13 节哪些场景完成。
6. **已知限制**：仅列真实未实现项，不把 V1 明确非目标当 bug。

Agent 不得只说“已实现”而不给测试结果；也不得在未实际执行命令时声称测试通过。

---

## 18. 基线源码参考

Agent 应优先阅读本地仓库对应文件。本文设计时参考的公开路径：

- `src/features/templates/editor.tsx`
- `src/features/templates/template-preview.tsx`
- `src/styles/templates.css`
- `src/components/ui/segmented.tsx`
- `src/api/types.ts`
- `worker/templates/validator.ts`
- `worker/templates/renderer.ts`
- `worker/templates/builtin.ts`
- `worker/routes/templates.ts`
- `package.json`

公开仓库：`https://github.com/linct96/wangwang`

**最终实现原则：先保证 YAML 不丢数据，再保证引用正确，再完成 UI。不要反过来。**
