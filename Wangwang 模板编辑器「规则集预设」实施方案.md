# Wangwang 模板编辑器「规则集预设」实施方案

## 1. 实施目标

基于当前已经完成的 `RuleProviderDraft + RULE-SET` 可视化能力，实现“规则集预设”功能。

用户无需手动填写：

- Provider 名称
- type
- behavior
- format
- url
- path
- interval
- RULE-SET 规则

即可从预设库中选择 GitHub、OpenAI、Telegram、CN、广告等常用规则集，并自动创建对应：

```yaml
rule-providers: ...

rules:
  - RULE-SET,...
```

本功能必须直接操作现有 `VisualTemplateDraft` 数据结构，不允许通过字符串拼接或直接修改 YAML 文本实现。

---

# 2. 当前代码基础

代码基线：

```text
99468ee8e0c779e03cee53225086aca6c4202380
```

当前已经存在：

```ts
VisualTemplateDraft.ruleProviders
```

以及：

```ts
StructuredRuleProviderDraft
RawRuleProviderDraft
RuleSetRuleDraft
```

RULE-SET 已经通过：

```ts
providerId
```

引用 Rule Provider。

现有代码已经支持：

- Rule Provider 创建
- Rule Provider 编辑
- Rule Provider 删除
- Provider 重命名
- Provider 引用检测
- RULE-SET 创建
- RULE-SET Provider 选择
- RULE-SET target 选择
- `no-resolve`
- Provider 校验
- YAML parse / serialize
- 新规则自动插入 MATCH 前

因此本功能不得重新实现以上能力。

规则集预设只应该是现有模型之上的：

```text
Preset Catalog
    ↓
VisualTemplateDraft
```

转换层。

---

# 3. 功能范围

第一版实现两个入口。

## 3.1 Provider 预设

位置：

```text
规则集数据源
```

现有：

```text
[添加数据源]
```

修改为：

```text
[从预设添加] [添加数据源]
```

“从预设添加”只负责批量创建：

```yaml
rule-providers:
```

不自动创建 RULE-SET。

适合需要自行配置分流规则的用户。

---

## 3.2 规则集快速添加

在分流规则区域增加：

```text
[从规则集添加] [添加规则]
```

“从规则集添加”同时创建：

```text
RuleProvider
+
RULE-SET
```

例如选择：

```text
GitHub
目标：🚀 节点选择
```

自动产生：

```yaml
rule-providers:
  github:
    type: http
    behavior: domain
    format: mrs
    url: ...
    path: ./ruleset/github.mrs
    interval: 86400

rules:
  - RULE-SET,github,🚀 节点选择
```

这是普通用户主要使用的入口。

---

# 4. 新增目录

建议新增：

```text
src/features/templates/visual/rule-set-presets/
```

目录结构：

```text
rule-set-presets/
├── types.ts
├── catalog.ts
├── helpers.ts
├── apply-presets.ts
├── preset-dialog.tsx
└── index.ts
```

不要把 Catalog 写入：

```text
visual/rules/
```

Preset 属于 Provider 与 Rule 两个模块之上的业务层。

---

# 5. Preset 数据模型

在：

```text
rule-set-presets/types.ts
```

定义：

```ts
export type RuleSetPresetSource = 'metacubex' | 'loyalsoldier'

export type RuleSetPresetCategory = 'common' | 'ai' | 'social' | 'media' | 'ads' | 'china' | 'development' | 'service'

export interface RuleSetPreset {
  id: string

  name: string
  description?: string

  source: RuleSetPresetSource
  category: RuleSetPresetCategory

  provider: {
    name: string

    type: 'http'
    behavior: 'domain' | 'ipcidr' | 'classical'
    format?: 'mrs' | 'yaml' | 'text'

    url: string
    path?: string
    interval?: number
  }

  defaultTarget?: string

  noResolve?: boolean

  keywords?: string[]
}
```

不要在 Catalog 中写内部：

```ts
id
providerId
```

这些属于当前模板 Draft，应在添加时动态生成。

---

# 6. Catalog 第一版内容

第一版控制在约 20～30 个常用规则。

默认优先使用 MetaCubeX。

建议包含：

## 常用

```text
Private
CN
CN IP
Proxy
Direct
Reject
```

## AI

```text
OpenAI
Claude
Gemini
```

## 开发服务

```text
GitHub
Google
Microsoft
Apple
OneDrive
```

## 社交

```text
Telegram
Twitter/X
Facebook
Instagram
```

## 流媒体

```text
YouTube
Netflix
Spotify
TikTok
Bilibili
Bahamut
```

## 广告

```text
category-ads-all
```

Catalog 必须集中维护。

禁止把预设数据写死在 React Component 中。

---

# 7. UI：Preset Dialog

新增：

```tsx
RuleSetPresetDialog
```

需要支持两种模式：

```ts
mode: 'provider-only' | 'provider-and-rule'
```

---

## Provider-only

入口：

```text
规则集数据源 → 从预设添加
```

界面：

```text
添加规则集数据源

[搜索...]

来源
[全部] [MetaCubeX] [Loyalsoldier]

分类
[全部] [常用] [AI] [社交] [流媒体] [广告] [国内]

☐ GitHub
  MetaCubeX
  Domain · MRS

☐ OpenAI
  MetaCubeX
  Domain · MRS

☐ Telegram
  MetaCubeX
  Domain · MRS

已选择 3 项

[取消] [添加]
```

---

## Provider-and-rule

入口：

```text
分流规则 → 从规则集添加
```

每一项额外提供：

```text
目标策略
```

例如：

```text
☑ GitHub
  Domain · MRS

  目标策略
  [🚀 节点选择 ▼]
```

Target 选择必须复用现有 Rule Target 的可选数据。

包括：

```text
DIRECT
REJECT
现有 proxy-groups
```

不要重新维护代理组列表。

---

# 8. 搜索与筛选

Dialog 至少支持：

```text
关键词搜索
来源过滤
分类过滤
```

搜索范围：

```text
preset.name
preset.provider.name
preset.description
preset.keywords
```

搜索使用简单的：

```ts
toLowerCase().includes()
```

即可。

第一版不需要 fuzzy search 库。

---

# 9. Preset → RuleProviderDraft

在：

```text
apply-presets.ts
```

实现纯函数。

例如：

```ts
createProviderFromPreset(
  preset: RuleSetPreset
): StructuredRuleProviderDraft
```

生成：

```ts
{
  id: createId(),
  kind: 'structured',

  name: preset.provider.name,

  type: preset.provider.type,
  behavior: preset.provider.behavior,
  format: preset.provider.format,

  url: preset.provider.url,
  path: preset.provider.path,
  interval: preset.provider.interval,

  ...
}
```

内部 ID 必须使用项目现有 ID 生成方式。

不要新增另外一种随机 ID 机制。

---

# 10. Provider 去重策略

添加预设前必须检查当前：

```ts
draft.ruleProviders
```

主要按照：

```text
Provider name
```

判断。

---

## 10.1 不存在

正常创建。

---

## 10.2 已存在且配置一致

不要重复创建。

状态显示：

```text
已存在
```

在 Provider-only 模式下直接跳过。

---

## 10.3 已存在但配置不同

禁止静默覆盖。

Dialog 中显示：

```text
GitHub

已有同名规则集数据源

当前：
https://xxx

预设：
https://yyy
```

提供：

```text
保留现有
使用预设覆盖
```

默认：

```text
保留现有
```

---

# 11. Provider ID 复用

这是实现中最重要的逻辑之一。

如果：

```text
github
```

Provider 已经存在，则规则预设必须引用现有：

```ts
provider.id
```

而不是再创建一个新的 Provider。

例如：

```ts
const providerId = existingProvider?.id ?? newProvider.id
```

之后 RULE-SET：

```ts
{
  provider: {
    kind: 'provider',
    providerId,
  }
}
```

禁止 RULE-SET 直接存：

```text
github
```

字符串。

---

# 12. RULE-SET 创建

Provider-and-rule 模式下，根据最终 Provider ID 创建：

```ts
RuleSetRuleDraft
```

结构类似：

```ts
{
  id: createId(),

  kind: 'structured',
  type: 'RULE-SET',

  provider: {
    kind: 'provider',
    providerId,
  },

  target,

  noResolve,
}
```

Target 使用用户选择值。

`noResolve` 默认来自：

```ts
preset.noResolve
```

但必须符合当前 Provider behavior。

---

# 13. no-resolve 处理

不能所有 RULE-SET 都允许：

```text
no-resolve
```

必须复用当前 validation / Rule Card 已有逻辑。

一般：

```text
ipcidr
```

类型规则才有意义。

Dialog 中：

- 不支持：不显示
- 支持：显示 checkbox
- Preset 有推荐值时自动初始化

不要复制一套新的判断逻辑。

建议把现有判断抽成：

```ts
canRuleProviderUseNoResolve(provider)
```

Preset Dialog 与 Rule Card 共用。

---

# 14. RULE-SET 去重

添加 RULE-SET 时不要只比较完整 YAML 字符串。

需要根据：

```text
providerId
```

判断是否已经存在 RULE-SET。

---

## 已存在相同 Provider + Target

跳过：

```text
已经存在
```

---

## 已存在相同 Provider、不同 Target

例如已有：

```text
github → Proxy
```

用户想新增：

```text
github → AI
```

Dialog 显示：

```text
GitHub 已有分流规则

当前：
github → Proxy

本次：
github → AI

[保留当前]
[修改为 AI]
```

默认：

```text
保留当前
```

第一版不要默认产生两个针对同一个 Provider 的 RULE-SET。

---

# 15. Rule 插入位置

必须复用当前：

```text
新规则插入第一个 MATCH 前
```

行为。

建议将 VisualEditor 当前 addRule 中的插入逻辑抽成：

```ts
insertRuleBeforeMatch(rules, newRules)
```

然后：

```text
普通添加规则
Preset 添加
```

统一调用。

不要在 Preset 功能中复制另一份 MATCH 搜索代码。

---

# 16. 原子更新 Draft

批量添加过程中不得执行：

```ts
onChange(addProvider(draft))
onChange(addRule(draft))
```

这样可能由于 React 闭包拿到旧 draft 导致修改相互覆盖。

必须：

```ts
const nextDraft = applyPresets(draft, selections)

onChange(nextDraft)
```

整个操作只触发一次：

```ts
onChange()
```

即：

```text
读取当前 Draft
      ↓
计算所有新增 Provider
      ↓
建立 providerId 映射
      ↓
计算所有 RULE-SET
      ↓
处理冲突
      ↓
插入 MATCH 前
      ↓
生成完整 nextDraft
      ↓
onChange(nextDraft)
```

---

# 17. applyPresets API

建议：

```ts
interface ApplyRuleSetPresetOptions {
  presetId: string

  target?: RuleTargetDraft

  providerConflict: 'keep' | 'replace'

  ruleConflict: 'keep' | 'replace'

  noResolve?: boolean
}

function applyRuleSetPresets(
  draft: VisualTemplateDraft,
  presets: RuleSetPreset[],
  selections: ApplyRuleSetPresetOptions[],
  mode: 'provider-only' | 'provider-and-rule',
): VisualTemplateDraft
```

函数必须保持：

```text
pure function
```

不要在里面操作 React State。

这样方便后续 UI、批量导入或模板初始化继续复用。

---

# 18. 不直接操作 YAML

禁止实现以下方案：

```ts
yaml += `
rule-providers:
...
`
```

也禁止在 Preset 模块中直接：

```ts
parseDocument()
```

Preset 层只负责：

```text
Catalog
  ↓
VisualTemplateDraft
```

已有：

```text
yaml-adapter.ts
```

负责：

```text
VisualTemplateDraft
  ↓
YAML
```

保持单向职责：

```text
Preset
    ↓
Draft
    ↓
YAML Adapter
    ↓
YAML
```

---

# 19. 组件改造

主要修改：

```text
src/features/templates/visual/visual-editor.tsx
```

在：

```text
规则集数据源
```

标题区域增加：

```tsx
<Button>从预设添加</Button>
```

点击：

```tsx
<RuleSetPresetDialog mode="provider-only" />
```

---

在：

```text
分流规则
```

增加：

```tsx
<Button>从规则集添加</Button>
```

调用：

```tsx
<RuleSetPresetDialog mode="provider-and-rule" />
```

---

# 20. 尽量复用现有组件

优先复用：

```text
Dialog
Button
Input
Badge
ScrollArea
Checkbox
Select / Combobox
Rule target selector
```

如果 Target Selector 当前只存在于：

```text
RuleCard
```

内部，可以抽成：

```tsx
RuleTargetCombobox
```

然后：

```text
RuleCard
PresetDialog
```

共同使用。

禁止复制一份 proxy-groups target selector。

---

# 21. Provider 展示状态

对于已经存在的规则：

```text
GitHub
MetaCubeX · Domain · MRS

[已存在]
```

如果存在但与预设不同：

```text
GitHub
MetaCubeX · Domain · MRS

[存在冲突]
```

如果已有 RULE-SET：

```text
GitHub
MetaCubeX · Domain · MRS

已配置：
🚀 节点选择
```

用户应在点击“添加”前看到最终影响。

---

# 22. 第一版不做的功能

本次不要实现：

```text
远程动态获取整个 MetaCubeX catalog
自动读取 GitHub releases
在线搜索所有 geosite
规则集订阅市场
用户自定义 Preset 持久化
Preset 云同步
拖拽排序
规则集自动更新检查
```

全部先使用：

```ts
catalog.ts
```

静态预设。

这样保证功能稳定、可控。

---

# 23. 后续可扩展能力

当前数据模型需要为后面留出：

```ts
source
category
keywords
```

这样未来可以将：

```text
catalog.ts
```

替换成：

```text
内置 Catalog
+
远程 Catalog
+
用户 Catalog
```

而无需修改 Dialog 主体。

---

# 24. 实施顺序

## Step 1：建立 Preset 数据层

新增：

```text
rule-set-presets/types.ts
rule-set-presets/catalog.ts
rule-set-presets/helpers.ts
rule-set-presets/apply-presets.ts
```

完成：

```text
Preset 类型
Catalog
Provider 创建
Provider 去重
RULE-SET 创建
RULE-SET 去重
MATCH 前插入
原子 Draft 更新
```

完成后不改 UI。

---

## Step 2：实现 Preset Dialog

新增：

```text
rule-set-presets/preset-dialog.tsx
```

实现：

```text
搜索
分类
来源
多选
目标策略选择
no-resolve
已存在状态
冲突状态
批量确认
```

同时抽取并复用现有：

```text
RuleTarget selector
no-resolve 判断
rule insert helper
```

---

## Step 3：接入 Visual Editor

修改：

```text
visual-editor.tsx
```

增加：

```text
规则集数据源 → 从预设添加
分流规则 → 从规则集添加
```

点击确认后：

```ts
const nextDraft = applyRuleSetPresets(...)

onChange(nextDraft)
```

并继续由现有：

```text
yaml-adapter
validation
```

负责最终 YAML 与校验。

---

# 25. 最终验收标准

以下场景必须正确。

### 场景 1

空模板添加：

```text
GitHub → Proxy
```

得到：

```yaml
rule-providers:
  github: ...

rules:
  - RULE-SET,github,Proxy
```

---

### 场景 2

已有：

```yaml
rule-providers:
  github: ...
```

再次添加 GitHub：

不得产生第二个：

```yaml
github:
```

---

### 场景 3

已有 GitHub Provider，但没有 RULE-SET。

快速添加：

```text
GitHub → Proxy
```

必须复用原 Provider ID。

---

### 场景 4

已有：

```text
GitHub → Proxy
```

再次添加：

```text
GitHub → Proxy
```

不得重复产生规则。

---

### 场景 5

已有：

```text
GitHub → Proxy
```

添加：

```text
GitHub → AI
```

必须提示冲突。

不得静默生成第二条。

---

### 场景 6

已有：

```yaml
- MATCH,...
```

Preset 创建的 RULE-SET 必须插入 MATCH 前。

---

### 场景 7

Provider 重命名后：

```text
RuleSetRuleDraft.provider.providerId
```

保持不变。

最终 YAML 自动输出新 Provider 名称。

---

### 场景 8

删除 Preset 创建的 Provider 时，如果仍存在 RULE-SET 引用：

继续使用现有删除保护逻辑。

---

### 场景 9

用户从 YAML 模式切换到可视化模式：

Preset 创建的数据应正常解析成：

```text
StructuredRuleProviderDraft
+
RuleSetRuleDraft
```

不得变成 RAW。

---

# 26. 代码原则

实现过程中遵守：

1. 不直接拼接 YAML。
2. Preset 层只操作 `VisualTemplateDraft`。
3. RULE-SET 必须通过 `providerId` 引用 Provider。
4. 不重复实现现有 validation。
5. 不重复实现 target selector。
6. 不重复实现 MATCH 插入逻辑。
7. 不静默覆盖已有用户配置。
8. 批量添加只调用一次 `onChange`。
9. Catalog 与 UI 解耦。
10. 优先最小范围修改现有代码。

---

# 27. 最终目标架构

```text
RuleSetPreset Catalog
          │
          ▼
RuleSetPresetDialog
          │
          ▼
applyRuleSetPresets()
          │
          ▼
VisualTemplateDraft
     │            │
     ▼            ▼
RuleProvider   RuleSetRule
     │            │
     └──── providerId ────┘
          │
          ▼
applyVisualTemplate()
          │
          ▼
        YAML
```

核心原则：

> 规则集预设不是新的 YAML 编辑机制，而是当前 Rule Provider + RULE-SET 可视化模型上的快捷创建层。

以现有 `99468ee8e0c779e03cee53225086aca6c4202380` 代码为基础实现，不重构已有 Rule Provider 与 RULE-SET 主流程。
