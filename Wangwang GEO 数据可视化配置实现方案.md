# Wangwang GEO 数据可视化配置实现方案

## 1. 任务目标

在模板「可视化编辑」模式中增加一个独立的 **GEO 数据**配置模块，支持以下 Mihomo 顶层配置：

```yaml
geodata-mode: true
geo-auto-update: true
geo-update-interval: 24

geox-url:
  geoip: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat'
  geosite: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat'
  mmdb: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb'
  asn: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb'
```

要求：

- YAML → Visual 正确解析
- Visual → YAML 正确写回
- 不破坏其它未知 YAML 根字段
- 不强制给旧模板注入 GEO 配置
- 支持 MetaCubeX 推荐配置一键应用
- 支持自定义 URL
- 与后续 GEOSITE/GEOIP autocomplete 共用数据源状态
- 保持 YAML 为唯一 source of truth

---

# 2. 不修改现有总体架构

当前：

```text
YAML
 ↓
parseVisualTemplate()
 ↓
VisualTemplateDraft
 ↓
VisualTemplateEditor
 ↓
applyVisualTemplate()
 ↓
YAML
```

继续沿用。

不要：

```text
单独 useState<GeoConfig>
单独保存 GEO 配置
额外数据库字段
```

GEO 必须成为：

```text
VisualTemplateDraft
```

的一部分。

---

# 3. 数据模型

修改：

```text
src/features/templates/visual/model.ts
```

新增：

```ts
export type GeoSettingsDraft = {
  geodataMode?: boolean | null
  geoAutoUpdate?: boolean | null
  geoUpdateInterval?: number | null

  geoxUrl: {
    geoip?: string | null
    geosite?: string | null
    mmdb?: string | null
    asn?: string | null
  }
}
```

修改：

```ts
export type VisualTemplateDraft = {
  geo: GeoSettingsDraft
  groups: ProxyGroupDraft[]
  rules: RuleDraft[]
}
```

---

# 4. `undefined / null / value` 语义

这一点必须严格实现。

### `undefined`

表示：

```text
当前 YAML 中没有该字段
Visual Editor 没有主动修改
```

序列化时：

```text
保持原 YAML 不动
```

不能自动添加，也不能自动删除。

---

### `null`

表示：

```text
用户明确要求删除该字段
```

序列化时执行：

```ts
doc.delete(...)
```

---

### 实际值

例如：

```ts
geodataMode: true
geoUpdateInterval: 24
```

表示：

```text
显式写入 YAML
```

---

## 为什么必须这么设计

例如用户导入：

```yaml
proxy-groups: ...
rules: ...
```

里面完全没有 GEO。

用户只修改一个代理组。

不能因为 Visual Editor 内部存在默认值，就偷偷生成：

```yaml
geodata-mode: true
geo-auto-update: true
...
```

所以禁止：

```ts
geo: {
  geodataMode: true,
  geoAutoUpdate: true,
  ...
}
```

作为所有模板的默认 Draft。

默认必须是：

```ts
geo: {
  geodataMode: undefined,
  geoAutoUpdate: undefined,
  geoUpdateInterval: undefined,
  geoxUrl: {}
}
```

---

# 5. 推荐配置常量

新增：

```text
src/features/templates/visual/geo/presets.ts
```

定义：

```ts
export const METACUBEX_FULL_GEO_PRESET = {
  geodataMode: true,
  geoAutoUpdate: true,
  geoUpdateInterval: 24,

  geoxUrl: {
    geoip: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat',

    geosite: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat',

    mmdb: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb',

    asn: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb',
  },
} satisfies GeoSettingsDraft
```

提供：

```ts
export function createRecommendedGeoSettings(): GeoSettingsDraft
```

返回深拷贝。

不要直接把常量对象写进 React state。

---

# 6. YAML Parser

修改：

```text
yaml-adapter.ts
```

新增：

```ts
parseGeoSettings(root): {
  draft: GeoSettingsDraft
  warnings: VisualIssue[]
}
```

## 解析规则

### geodata-mode

合法：

```yaml
geodata-mode: true
geodata-mode: false
```

对应：

```ts
geodataMode: true
geodataMode: false
```

不存在：

```ts
undefined
```

类型错误：

```yaml
geodata-mode: yes123
```

不要直接覆盖。

处理：

```ts
geodataMode: undefined
```

同时生成 warning：

```text
GEO_GEODATA_MODE_INVALID
```

---

### geo-auto-update

同理：

```ts
boolean | undefined
```

---

### geo-update-interval

只接受：

```ts
number
```

Parser 阶段只处理类型。

是否：

```text
整数
> 0
```

交给 validation。

---

### geox-url

合法结构：

```yaml
geox-url:
  geoip: ...
  geosite: ...
  mmdb: ...
  asn: ...
```

分别解析字符串。

未知字段：

```yaml
geox-url:
  geoip: ...
  my-custom-field: xxx
```

必须保留。

Visual Editor 不需要显示：

```text
my-custom-field
```

但绝对不能删除。

---

# 7. YAML Serializer

增加：

```ts
applyGeoSettings(doc, geo)
```

不要：

```ts
doc.set('geox-url', {
  geoip,
  geosite,
  mmdb,
  asn,
})
```

因为这样会覆盖：

```yaml
geox-url:
  some-future-mihomo-field: xxx
```

以及可能破坏已有 YAML Node。

---

## 顶层字段

实现：

```ts
function applyOptionalRootField(doc, key, value) {
  if (value === undefined) {
    return
  }

  if (value === null) {
    doc.delete(key)
    return
  }

  doc.set(key, value)
}
```

应用：

```ts
applyOptionalRootField(doc, 'geodata-mode', geo.geodataMode)

applyOptionalRootField(doc, 'geo-auto-update', geo.geoAutoUpdate)

applyOptionalRootField(doc, 'geo-update-interval', geo.geoUpdateInterval)
```

---

# 8. `geox-url` 必须局部修改 YAML Map

逻辑：

```text
读取 geox-url Node
      ↓
如果存在并且是 Map
      ↓
复用这个 Map
      ↓
只修改：
geoip
geosite
mmdb
asn
```

不要重建整个对象。

伪代码：

```ts
function applyGeoxUrl(doc, value) {
  let node = doc.get('geox-url', true)

  const hasWrite =
    value.geoip !== undefined || value.geosite !== undefined || value.mmdb !== undefined || value.asn !== undefined

  if (!hasWrite) return

  if (!isMap(node)) {
    node = doc.createNode({})
    doc.set('geox-url', node)
  }

  applyMapField(node, 'geoip', value.geoip)
  applyMapField(node, 'geosite', value.geosite)
  applyMapField(node, 'mmdb', value.mmdb)
  applyMapField(node, 'asn', value.asn)

  if (node.items.length === 0) {
    doc.delete('geox-url')
  }
}
```

其中：

```ts
undefined → 不碰原值
null      → 删除
value     → set
```

---

# 9. 修改 applyVisualTemplate

现在：

```text
proxy-groups
rules
```

修改为：

```text
GEO
proxy-groups
rules
```

逻辑：

```ts
export function applyVisualTemplate(
  yamlText: string,
  draft: VisualTemplateDraft,
) {
  const doc = parseDocument(yamlText)

  applyGeoSettings(doc, draft.geo)

  // 保持现在代理组逻辑
  ...

  // 保持现在 Rules 逻辑
  ...

  return String(doc)
}
```

禁止重构现有 proxy group / rule serializer。

本任务只增加 GEO。

---

# 10. UI 位置

Visual Editor 当前顺序：

```text
代理组
规则
```

调整为：

```text
GEO 数据
代理组
规则
```

GEO 属于整个配置的全局设置，因此必须放在最上方。

新增：

```text
src/features/templates/visual/geo/
├── geo-settings-panel.tsx
├── presets.ts
├── validation.ts
└── utils.ts
```

最终：

```tsx
<GeoSettingsPanel
  value={draft.geo}
  issues={geoIssues}
  onChange={(geo) =>
    update({
      ...draft,
      geo,
    })
  }
/>

<GroupList ... />

<RuleList ... />
```

---

# 11. GEO Panel UI

推荐布局：

```text
GEO 数据
──────────────────────────────────

用于 GEOSITE、GEOIP 和 ASN 规则的数据文件。

[应用推荐配置]

GEOIP 数据格式
● DAT
○ MMDB
○ 使用 Mihomo 默认值

自动更新
[ 开启 ]

更新间隔
[ 24 ] 小时


数据下载地址                         [恢复推荐值]
──────────────────────────────────

GeoIP DAT                当前使用
[ https://github.com/.../geoip.dat ]

GeoSite DAT
[ https://github.com/.../geosite.dat ]

Country MMDB             备用
[ https://github.com/.../country.mmdb ]

ASN MMDB
[ https://github.com/.../GeoLite2-ASN.mmdb ]
```

---

# 12. `geodata-mode` UI

不要直接给用户显示：

```text
geodata-mode true / false
```

显示：

```text
GEOIP 数据格式

○ 使用 Mihomo 默认
● DAT
○ MMDB
```

映射：

```text
默认
→ undefined / null

DAT
→ true

MMDB
→ false
```

### 推荐配置

默认选择：

```text
DAT
```

即：

```yaml
geodata-mode: true
```

---

# 13. 当前实际使用的数据文件提示

根据：

```ts
geodataMode
```

动态标记。

### DAT

```text
GeoIP DAT      当前使用
Country MMDB   备用
```

### MMDB

```text
GeoIP DAT      备用
Country MMDB   当前使用
```

`geosite`：

```text
始终用于 GEOSITE
```

`asn`：

```text
用于 IP-ASN / SRC-IP-ASN
```

不要因为当前 DAT 模式而隐藏 MMDB URL。

用户切换模式时应该还能保留之前的地址。

---

# 14. 自动更新

UI：

```text
自动更新 GEO 数据
[Switch]
```

状态：

```ts
true
false
undefined
```

如果当前：

```ts
undefined
```

Switch 可以按照 Mihomo 默认关闭状态显示，并增加：

```text
使用默认值
```

的小提示。

用户操作 Switch 后产生显式：

```ts
true / false
```

提供一个：

```text
恢复默认
```

入口，把值重新设置：

```ts
undefined
```

---

# 15. 更新间隔

字段：

```yaml
geo-update-interval: 24
```

UI：

```text
更新间隔
[ 24 ] 小时
```

要求：

- type=number
- step=1
- 最低 1
- 只允许整数
- `<= 0` Error
- 非整数 Error

不要人为添加不必要的最大值限制。

当：

```text
自动更新关闭
```

时不要隐藏该字段。

可以降低视觉权重，并显示：

```text
开启自动更新后生效
```

这样用户切换开关时不会丢失原值。

---

# 16. 下载地址区域

四个字段全部使用普通 URL Input。

字段：

### GeoIP DAT

```text
GeoIP DAT
```

说明：

```text
geodata-mode 使用 DAT 时用于 GEOIP
```

---

### GeoSite DAT

```text
GeoSite DAT
```

说明：

```text
用于 GEOSITE 规则
```

---

### Country MMDB

```text
Country MMDB
```

说明：

```text
geodata-mode 使用 MMDB 时用于 GEOIP
```

---

### ASN MMDB

```text
ASN MMDB
```

说明：

```text
用于 IP-ASN / SRC-IP-ASN
```

---

# 17. 快捷操作

Panel 顶部提供：

```text
应用推荐配置
```

点击后：

```ts
onChange(createRecommendedGeoSettings())
```

结果必须生成完整：

```yaml
geodata-mode: true
geo-auto-update: true
geo-update-interval: 24
geox-url:
  geoip: ...
  geosite: ...
  mmdb: ...
  asn: ...
```

---

另外提供：

```text
移除 GEO 配置
```

这是危险操作。

点击后不要删除其它根字段。

设置：

```ts
{
  geodataMode: null,
  geoAutoUpdate: null,
  geoUpdateInterval: null,

  geoxUrl: {
    geoip: null,
    geosite: null,
    mmdb: null,
    asn: null,
  },
}
```

Serializer 负责真正删除。

如果 `geox-url` 还存在其它未知字段：

```yaml
geox-url:
  custom: xxx
```

则：

```yaml
geox-url:
  custom: xxx
```

必须继续保留。

---

# 18. Panel 状态摘要

折叠状态或者标题旁显示：

### 推荐配置已启用

```text
DAT · 自动更新 · 24h
```

### MMDB

```text
MMDB · 自动更新 · 24h
```

### 未配置

```text
使用 Mihomo 默认配置
```

### 自定义 URL

可以显示：

```text
DAT · 自定义数据源
```

不要展示长 URL。

---

# 19. Validation

修改现有：

```text
validation.ts
```

增加 GEO Validation。

新增 VisualIssue 可选字段：

```ts
export type GeoIssueField =
  'geodata-mode' | 'geo-auto-update' | 'geo-update-interval' | 'geoip' | 'geosite' | 'mmdb' | 'asn'
```

在：

```ts
VisualIssue
```

增加：

```ts
geoField?: GeoIssueField
```

不要修改现有：

```ts
groupId
ruleId
```

逻辑。

---

# 20. Validation 规则

## 更新间隔

以下为 Error：

```text
0
-1
1.5
NaN
```

提示：

```text
GEO 更新间隔必须是大于 0 的整数小时
```

---

## URL

如果字段有值：

```text
geoip
geosite
mmdb
asn
```

必须是合法：

```text
http://
https://
```

非法：

```text
github.com/xxx
abc
ftp://xxx
```

产生 Error。

---

## 空字符串

用户把 URL 输入框清空：

不要序列化：

```yaml
geoip: ''
```

UI onBlur 或 normalize 时：

```text
"" → null
```

表示删除该字段。

---

# 21. 不进行的 Validation

不要强制：

```text
DAT 模式一定必须填写 geoip
MMDB 模式一定必须填写 mmdb
GEOSITE 一定必须填写 geosite
```

原因：

用户可以依赖 Mihomo 自己的默认资源地址。

所以：

```yaml
geodata-mode: true
```

本身仍然允许保存。

---

# 22. 与 GEOSITE/GEOIP Autocomplete 集成

之前的 autocomplete 需要判断：

```text
Full
Lite
```

本次 GEO 设置完成后，不应该重新解析 YAML。

直接使用：

```ts
draft.geo
```

例如：

```ts
inferGeoDataset(draft.geo)
```

判断：

```text
geoip.dat
→ full

geoip-lite.dat
→ lite

geosite.dat
→ full

geosite-lite.dat
→ lite
```

形成：

```text
GeoSettingsDraft
      ↓
inferGeoDataset()
      ↓
GEOSITE/GEOIP autocomplete
```

GEO Settings 应成为 autocomplete 的统一配置来源。

---

# 23. 推荐文件结构

最终：

```text
src/features/templates/visual/
├── model.ts
├── validation.ts
├── yaml-adapter.ts
├── visual-editor.tsx
│
├── geo/
│   ├── geo-settings-panel.tsx
│   ├── presets.ts
│   ├── utils.ts
│   └── validation.ts
│
├── groups/
└── rules/
```

如果 GEO Validation 很短，可以继续放：

```text
visual/validation.ts
```

不要为了拆文件而拆文件。

---

# 24. YAML Adapter 测试

重点补：

```text
yaml-adapter.test.ts
```

至少新增以下测试。

## Case 1：完整解析

输入：

```yaml
geodata-mode: true
geo-auto-update: true
geo-update-interval: 24
geox-url:
  geoip: https://example.com/geoip.dat
  geosite: https://example.com/geosite.dat
  mmdb: https://example.com/country.mmdb
  asn: https://example.com/asn.mmdb

proxy-groups: []
rules: []
```

必须完整进入：

```ts
draft.geo
```

---

## Case 2：Round Trip

```text
YAML
→ VisualDraft
→ applyVisualTemplate()
→ YAML
```

所有 GEO 值保持一致。

---

## Case 3：没有 GEO

输入：

```yaml
ipv6: false
proxy-groups: []
rules: []
```

修改代理组后：

禁止生成：

```yaml
geodata-mode:
geo-auto-update:
geo-update-interval:
geox-url:
```

---

## Case 4：部分配置

输入：

```yaml
geo-auto-update: true
```

修改 Rule 后输出仍然只包含：

```yaml
geo-auto-update: true
```

禁止偷偷补全其它 GEO 字段。

---

## Case 5：未知 root 字段

输入：

```yaml
foo: bar
geodata-mode: true
```

修改 GEO 后：

```yaml
foo: bar
```

必须保留。

---

## Case 6：未知 geox-url 字段

输入：

```yaml
geox-url:
  geoip: https://example.com/a.dat
  future-field: hello
```

修改 geoip 后：

```yaml
future-field: hello
```

必须存在。

---

## Case 7：删除一个 URL

Draft：

```ts
geo.geoxUrl.geoip = null
```

只删除：

```yaml
geoip:
```

其它：

```text
geosite
mmdb
asn
```

必须保留。

---

## Case 8：删除整个 GEO 配置

执行：

```text
移除 GEO 配置
```

只删除本功能管理的字段。

其它 YAML 不变。

---

# 25. Validation 测试

必测：

```text
interval = 24      → valid
interval = 1       → valid
interval = 0       → error
interval = -1      → error
interval = 1.5     → error

https URL           → valid
http URL            → valid
abc                  → error
ftp://               → error
```

---

# 26. Preset 测试

测试：

```ts
createRecommendedGeoSettings()
```

必须返回：

```text
geodataMode = true
geoAutoUpdate = true
geoUpdateInterval = 24
```

四个 MetaCubeX Full URL 完整正确。

调用两次：

```ts
a !== b
```

保证返回不同对象，避免 state 共享引用。

---

# 27. 不修改 blankTemplate

本任务不要把 GEO 默认配置直接塞进：

```ts
blankTemplate
```

原因：

新建空白模板应该仍然保持精简。

用户主动点击：

```text
应用推荐配置
```

后才生成 GEO YAML。

内置：

```text
minimal
standard
full
```

是否默认启用 GEO，后续单独决定。

不要在本任务扩大范围。

---

# 28. 不做的内容

本任务明确不做：

```text
geodata-loader
geosite-matcher
global-ua
etag-support

下载 GEO 文件
测试 URL 是否实际可下载
解析 DAT/MMDB
GEO 数据版本检测
GitHub Proxy 自动转换
自定义 GEO 源管理
GEO autocomplete 本身
ASN autocomplete
```

只负责：

```text
可视化配置
YAML 双向同步
Validation
```

---

# 29. UI 行为原则

必须：

- 普通用户看到中文含义，不需要理解 YAML key
- 高级用户仍然可以修改全部 4 个 URL
- 切换 DAT/MMDB 不删除任何 URL
- 关闭自动更新不删除更新间隔
- 自动更新设置和 GEO URL 设置互不耦合
- 不自动修改用户已有自定义 URL
- 不因为进入 Visual 模式而增加配置
- 不因为编辑 Proxy Group 而重写 GEO
- 不把 GEO 配置存在 React 独立 state

---

# 30. 实现顺序

AI 严格按照以下顺序执行：

```text
1. 阅读当前 model.ts
2. 阅读 yaml-adapter.ts
3. 阅读 validation.ts
4. 阅读 visual-editor.tsx

5. 增加 GeoSettingsDraft

6. 增加推荐 preset

7. 实现 parseGeoSettings()

8. 实现 applyGeoSettings()

9. 接入 parseVisualTemplate()

10. 接入 applyVisualTemplate()

11. 先补 YAML Adapter 单测

12. 增加 GEO validation

13. 补 validation 单测

14. 实现 GeoSettingsPanel

15. 接入 VisualTemplateEditor

16. 实现“应用推荐配置”

17. 实现“移除 GEO 配置”

18. 检查 YAML Preview 实时同步

19. 运行本功能相关 Vitest

20. TypeScript typecheck

21. lint
```

不要为了完成本任务运行无关的大规模测试。

---

# 31. 最终验收 YAML

点击：

```text
应用推荐配置
```

后必须生成：

```yaml
geodata-mode: true
geo-auto-update: true
geo-update-interval: 24
geox-url:
  geoip: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat'
  geosite: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat'
  mmdb: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb'
  asn: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb'
```

现有：

```yaml
dns:
tun:
proxies:
proxy-providers:
rule-providers:
hosts:
```

以及其它未知根字段必须完全保留。

---

# 32. 最终验收标准

本任务只有以下条件全部满足才算完成：

- GEO Settings 已纳入 `VisualTemplateDraft`
- GEO UI 位于代理组、Rules 之前
- DAT/MMDB 可视化切换正常
- 自动更新可配置
- 更新周期可配置
- 四个 URL 可编辑
- 推荐 MetaCubeX Full 配置可以一键应用
- YAML → Visual 正确
- Visual → YAML 正确
- 未配置 GEO 的模板不会被自动注入
- 部分 GEO 配置不会被自动补全
- 未知根字段不丢失
- 未知 `geox-url` 字段不丢失
- Validation 正常
- Preview 实时更新
- 保存链路无需新增 API
- 原 proxy-groups / rules 功能无回归

## 核心设计原则

本功能不是“生成一段 GEO YAML”。

而是把：

```text
GEO 全局配置
```

正式纳入 Wangwang 已有的：

```text
YAML
↕
VisualDraft
↕
Visual Editor
```

双向编辑体系。

最重要的实现要求是：

```text
只修改用户明确操作的 GEO 字段，
绝不为了可视化方便而重写或补全用户原有 YAML。
```
