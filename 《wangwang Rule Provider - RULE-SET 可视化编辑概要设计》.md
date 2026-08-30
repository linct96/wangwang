# 《wangwang Rule Provider / RULE-SET 可视化编辑概要设计》

## 1. 项目基准

仓库：

`https://github.com/linct96/wangwang`

开发基准 Commit：

`375036a4ac48b92ddbcb2b67715fded8591c7f6e`

本功能基于现有模板可视化编辑器增量实现，不重新设计模板编辑器架构。

核心架构保持：

```text
YAML
↓ parseVisualTemplate
VisualTemplateDraft
↓ 用户可视化编辑
applyVisualTemplate
↓
YAML
```

YAML 仍然是唯一持久化真源。

---

# 2. 功能目标

新增两类可视化能力：

## 2.1 Rule Provider

支持可视化维护：

```yaml
rule-providers:
  cn_domain:
    type: http
    behavior: domain
    format: mrs
    url: https://example.com/cn.mrs
    interval: 86400
```

主要支持：

```text
type:
- http
- file
- inline

behavior:
- domain
- ipcidr
- classical

format:
- yaml
- text
- mrs
```

以及：

```text
url
path
interval
proxy
payload
header
path-in-bundle
size-limit
```

---

## 2.2 RULE-SET

将当前作为 RAW Rule 处理的：

```yaml
RULE-SET,cn_domain,DIRECT
RULE-SET,cn_ip,节点选择,no-resolve
```

升级为正式结构化规则。

RULE-SET 必须通过运行时 ID 引用 Rule Provider，而不是内部保存 Provider name 字符串。

---

# 3. 页面结构

模板可视化编辑器调整为：

```text
GEO 数据

代理组

规则集数据源
rule-providers

分流规则
rules
```

UI 名词统一：

```text
rule-providers
→ 规则集数据源

RULE-SET
→ 规则集规则

rules
→ 分流规则
```

---

# 4. 核心数据关系

建立：

```text
RuleProviderDraft
        ▲
        │ providerId
        │
    RULE-SET
        │
        │ target.groupId
        ▼
 ProxyGroupDraft
```

同时：

```text
RuleProviderDraft
        │
        │ proxy.groupId
        ▼
 ProxyGroupDraft
```

因此 VisualDraft 内的对象关系全部使用 ID，不使用名称字符串作为主关联方式。

---

# 5. 总体数据模型

VisualTemplateDraft：

```ts
type VisualTemplateDraft = {
  geo: GeoSettingsDraft
  groups: ProxyGroupDraft[]
  ruleProviders: RuleProviderDraft[]
  rules: RuleDraft[]
}
```

Rule Provider：

```ts
type RuleProviderDraft = StructuredRuleProviderDraft | RawRuleProviderDraft
```

RULE-SET：

```ts
type RuleSetRuleDraft = {
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

# 6. YAML 处理原则

必须满足：

```text
YAML
→ Visual
→ YAML
```

过程中：

- 普通 Provider 可编辑。
- 未识别字段不得无故丢失。
- YAML Anchor / Alias / Merge 不得被自动展开或破坏。
- RAW Provider 编辑其他内容时必须原样保留。
- RULE-SET Provider 重命名后引用自动更新。
- Proxy Group 重命名后 Provider.proxy 自动更新。

禁止简单：

```ts
doc.set('rule-providers', plainObject)
```

整体覆盖 `rule-providers`。

Provider 应采用 AST 增量更新。

---

# 7. 三阶段拆分

整个开发拆成三个步骤。

## 第一阶段：数据模型与 YAML 基础能力

目标：

```text
让系统“认识” rule-providers 和 RULE-SET
```

实现：

- RuleProviderDraft
- RuleSetRuleDraft
- rule-providers YAML parse
- RULE-SET parse
- rule-providers YAML apply
- RULE-SET serialize
- Anchor/Merge RAW 保留
- previousDraft 支持

阶段完成后即使暂时没有 UI，也必须已经能够完成：

```text
YAML → Draft → YAML
```

---

## 第二阶段：Rule Provider 可视化管理

目标：

```text
让用户完整创建和编辑 rule-providers
```

实现：

- ProviderList
- ProviderCard
- ProviderDialog
- HTTP / FILE / INLINE 动态表单
- validation
- Provider 删除
- Provider 重命名
- Provider.proxy 和 Proxy Group 引用
- RAW Provider UI

完成后用户可以通过 Visual 页面管理 Provider。

---

## 第三阶段：RULE-SET 可视化与完整引用闭环

目标：

```text
让 rules 正式消费 rule-providers
```

实现：

- RULE-SET 加入 RuleMatcher
- RuleProviderCombobox
- RuleCard / RuleDialog 支持 RULE-SET
- no-resolve 联动
- Provider 引用统计
- 删除保护
- 重命名引用同步
- RAW Rule 潜在引用处理
- UI 收尾和状态提示

完成后形成：

```text
Proxy Group
↕
Rule Provider
↕
RULE-SET
```

完整引用体系。

---

# 8. 三阶段依赖

严格按顺序执行：

```text
阶段一
数据模型 + YAML
        ↓
阶段二
Provider UI
        ↓
阶段三
RULE-SET + 引用闭环
```

不要三个阶段并行开发。

阶段二依赖阶段一稳定的数据结构。

阶段三依赖阶段二产生的 Provider 管理能力。

---

# 9. 不在本次范围

不要顺带实现：

- 完整 YAML Anchor 可视化编辑器。
- 完整 Mihomo 所有 Rule 类型。
- Inline Provider payload 的复杂规则编辑器。
- 重构整个模板 Editor。
- 重构现有 proxy-groups YAML 写入。
- 新状态管理库。
- 新 UI 组件库。
- 新 YAML 库。

只对现有架构进行必要扩展。

---

# 10. 最终完成状态

最终用户应能够可视化完成：

```yaml
rule-providers:
  cn_domain:
    type: http
    behavior: domain
    format: mrs
    url: https://example.com/cn-domain.mrs
    interval: 86400

  cn_ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: https://example.com/cn-ip.mrs
    interval: 86400
    proxy: 节点选择

rules:
  - RULE-SET,cn_domain,DIRECT
  - RULE-SET,cn_ip,国内直连,no-resolve
  - MATCH,节点选择
```

而不需要切换到 YAML 模式手工维护普通 `rule-providers / RULE-SET` 配置。
