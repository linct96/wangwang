# 《实施方案一：数据模型与 YAML 双向转换》

## 1. 阶段目标

本阶段只解决底层能力：

```text
让 VisualTemplateDraft 正确认识：

rule-providers
RULE-SET
Provider ↔ Group 引用
RULE-SET ↔ Provider 引用
```

暂时不要实现 Provider UI。

完成后必须能够：

```text
已有 YAML
↓
parseVisualTemplate()
↓
完整 VisualTemplateDraft
↓
applyVisualTemplate()
↓
正确 YAML
```

---

# 2. 修改 model.ts

文件：

```text
src/features/templates/visual/model.ts
```

## 2.1 VisualTemplateDraft

增加：

```ts
ruleProviders: RuleProviderDraft[]
```

形成：

```ts
export type VisualTemplateDraft = {
  geo: GeoSettingsDraft
  groups: ProxyGroupDraft[]
  ruleProviders: RuleProviderDraft[]
  rules: RuleDraft[]
}
```

---

## 2.2 Provider 类型

增加：

```ts
export type RuleProviderType = 'http' | 'file' | 'inline'

export type RuleProviderBehavior = 'domain' | 'ipcidr' | 'classical'

export type RuleProviderFormat = 'yaml' | 'text' | 'mrs'
```

---

## 2.3 Provider proxy

不要保存：

```ts
proxy: string
```

改成：

```ts
export type RuleProviderProxyDraft =
  | {
      kind: 'group'
      groupId: string
    }
  | {
      kind: 'builtin'
      value: 'DIRECT'
    }
  | {
      kind: 'raw'
      value: string
    }
```

这样 Proxy Group 重命名不会产生悬空引用。

---

## 2.4 Structured Provider

实现：

```ts
export type StructuredRuleProviderDraft = {
  kind: 'structured'

  id: string
  name: string

  type: RuleProviderType
  behavior: RuleProviderBehavior
  format?: RuleProviderFormat

  url?: string
  path?: string
  interval?: number

  proxy?: RuleProviderProxyDraft

  pathInBundle?: string
  sizeLimit?: number

  header?: Record<string, string[]>
  payload?: string[]

  extras: Record<string, unknown>
}
```

---

## 2.5 RAW Provider

增加：

```ts
export type RawRuleProviderDraft = {
  kind: 'raw'

  id: string
  name: string

  reason?: string
}
```

主要用于：

```yaml
<<: *domain
```

或者其他目前无法安全编辑的 YAML AST。

---

# 3. 重构 RuleDraft

不要：

```ts
RULE-SET.value = providerName
```

新增真正的 Provider Reference。

## 3.1 普通规则

```ts
export type ValueRuleDraft = {
  kind: 'structured'
  id: string

  type: 'DOMAIN' | 'DOMAIN-SUFFIX' | 'DOMAIN-KEYWORD' | 'GEOSITE' | 'GEOIP' | 'IP-CIDR' | 'IP-CIDR6'

  value: string

  target: RuleTargetDraft
  noResolve: boolean
}
```

---

## 3.2 RULE-SET

```ts
export type RuleSetRuleDraft = {
  kind: 'structured'
  id: string

  type: 'RULE-SET'

  provider:
    | {
        kind: 'provider'
        providerId: string
      }
    | {
        kind: 'raw'
        value: string
      }

  target: RuleTargetDraft
  noResolve: boolean
}
```

---

## 3.3 MATCH

```ts
export type MatchRuleDraft = {
  kind: 'structured'
  id: string

  type: 'MATCH'

  target: RuleTargetDraft
  noResolve: false
}
```

最终合并成新的：

```ts
StructuredRuleDraft
```

---

# 4. Provider runtime ID

沿用现有 runtimeId 机制。

Provider 解析时创建：

```ts
runtimeId('provider', index)
```

建立：

```ts
Map<providerName, providerId>
```

例如：

```text
cn_domain → provider-0-xxx
cn_ip     → provider-1-xxx
```

---

# 5. 调整 YAML Parse 顺序

文件：

```text
yaml-adapter.ts
```

目标顺序：

```text
parseDocument
↓
root
↓
Geo
↓
建立 groupIds
↓
parse groups
↓
parse rule-providers
↓
建立 providerIds
↓
parse rules
```

原因：

Rule Provider 的 `proxy` 依赖 Group。

RULE-SET 又依赖 Provider。

---

# 6. 实现 parseRuleProviders()

增加：

```ts
parseRuleProviders(doc, root, groupIds)
```

处理：

```yaml
rule-providers:
  cn:
    type: http
    behavior: domain
    format: mrs
    url: ...
```

普通 Mapping：

```text
→ StructuredRuleProviderDraft
```

解析 `proxy` 时：

```text
找到 group name
→ groupId

DIRECT
→ builtin

未知名称
→ raw
```

---

# 7. RAW Provider 判断

解析 Provider 时必须检查原始 AST。

如果存在：

```text
Alias
<< Merge
复杂 Tag
其他不能安全重建的 Node
```

不要把 resolved object 当普通 Provider 编辑。

返回：

```ts
{
  kind: 'raw',
  id,
  name,
  reason: 'yaml-merge'
}
```

示例：

```yaml
cn_domain:
  <<: *domain
  url: ...
```

应进入 RAW。

---

# 8. RULE-SET Parser

修改：

```ts
parseRule()
```

参数增加：

```ts
providerIds
```

识别：

```yaml
RULE-SET,cn_domain,DIRECT
RULE-SET,cn_ip,节点选择,no-resolve
```

Provider 存在：

```ts
provider: {
  kind: 'provider',
  providerId,
}
```

Provider 不存在：

```ts
provider: {
  kind: 'raw',
  value: providerName,
}
```

不要让整条 Rule 降级 RAW。

---

# 9. RULE-SET Serializer

`serializeRule()` 增加：

```text
providerId
↓
providerNames
↓
provider.name
```

输出：

```yaml
RULE-SET,cn_domain,DIRECT
```

支持：

```yaml
RULE-SET,cn_ip,DIRECT,no-resolve
```

---

# 10. 修改 applyVisualTemplate()

调整函数：

```ts
applyVisualTemplate(
  yaml,
  nextDraft,
  previousDraft?,
)
```

调用端同步传入当前 visualDraft。

主要原因是 Provider key rename。

例如：

```text
previous:
id = A
name = cn

next:
id = A
name = china
```

通过 ID 判断这是重命名，不是“删除 + 新建”。

---

# 11. Provider AST Apply

新增：

```ts
applyRuleProviders()
```

不要整体：

```ts
doc.set('rule-providers', ...)
```

应该操作 `rule-providers` YAMLMap。

支持：

```text
新增
删除
重命名 key
修改 Structured Provider
保留 RAW Provider
```

未发生修改的 RAW Provider AST 必须保持原样。

---

# 12. Provider 序列化

普通 Provider 输出：

```text
type
behavior
format
url
path
interval
proxy
path-in-bundle
size-limit
header
payload
extras
```

空 optional 字段不要输出。

`proxy.groupId`：

```text
groupId
↓
group name
↓
YAML
```

---

# 13. VisualIssue 扩展

增加：

```ts
providerId?: string
```

方便后续 Validation / UI 定位 Provider。

---

# 14. 本阶段不要做

本阶段禁止：

```text
Provider Card
Provider Dialog
RULE-SET Combobox
UI 样式
引用数量 UI
```

只做 Model 和 YAML 数据闭环。

---

# 15. 本阶段验收

以下 YAML：

```yaml
proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - DIRECT

rule-providers:
  cn_domain:
    type: http
    behavior: domain
    format: mrs
    url: https://example.com/cn.mrs
    interval: 86400

  cn_ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: https://example.com/cn-ip.mrs
    proxy: 节点选择

rules:
  - RULE-SET,cn_domain,DIRECT
  - RULE-SET,cn_ip,节点选择,no-resolve
  - MATCH,节点选择
```

必须能够完整解析为 VisualDraft。

再执行：

```text
applyVisualTemplate
```

必须生成语义等价 YAML。

另外：

```yaml
rule-providers:
  cn:
    <<: *domain
    url: ...
```

必须作为 RAW Provider 保留，编辑其他可视化配置不得破坏该节点。

完成这些条件后才进入阶段二。
