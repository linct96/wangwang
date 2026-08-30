# 《实施方案二、三：Provider 可视化管理与 RULE-SET 引用闭环》

# 第一部分：实施方案二——Rule Provider 可视化管理

## 1. 阶段目标

建立独立的“规则集数据源”编辑区域。

用户能够通过 Visual 模式完成：

```text
创建 Provider
编辑 Provider
删除 Provider
查看 Provider
维护 HTTP / FILE / INLINE
```

本阶段主要消费第一阶段已经完成的：

```text
RuleProviderDraft
parseRuleProviders
applyRuleProviders
```

不要再重新定义数据结构。

---

## 2. 新增目录

```text
src/features/templates/visual/rule-providers/

index.ts
provider-list.tsx
provider-card.tsx
provider-dialog.tsx
provider-combobox.tsx
```

`provider-combobox.tsx` 在阶段三正式用于 RULE-SET，但可以本阶段建立基础组件。

---

## 3. VisualEditor 页面

页面调整为：

```text
GEO 数据
↓
代理组
↓
规则集数据源
↓
分流规则
```

新增 Section Header：

```text
规则集数据源       3        添加数据源
```

空状态：

```text
暂无规则集数据源

创建规则集数据源后，
即可通过 RULE-SET 在分流规则中引用。

[添加规则集数据源]
```

---

## 4. ProviderCard

视觉和现有 GroupCard 保持一致。

收起：

```text
cn_domain

HTTP · DOMAIN · MRS

2 条规则引用

编辑    删除
```

展开：

```text
URL
https://example.com/cn.mrs

更新间隔
86400 秒

缓存路径
自动

下载代理
DIRECT
```

本阶段引用数量可以先实现基础函数，阶段三再完整接入 RULE-SET。

---

## 5. ProviderDialog

基础字段：

```text
名称

类型
HTTP / FILE / INLINE

规则行为
DOMAIN / IPCIDR / CLASSICAL

文件格式
MRS / YAML / TEXT
```

根据 Type 动态变化。

---

## 6. HTTP

显示：

```text
名称

类型：HTTP

规则行为

文件格式

URL

更新间隔

缓存路径（可选）

下载代理（可选）

高级配置
```

默认：

```text
behavior = domain
format = mrs
interval = 86400
```

---

## 7. FILE

显示：

```text
名称

类型：FILE

规则行为

文件格式

文件路径
```

隐藏 HTTP 专用字段。

---

## 8. INLINE

显示：

```text
名称

类型：INLINE

规则行为

规则内容

item 1    删除
item 2    删除

+ 添加规则
```

内部继续：

```ts
payload: string[]
```

不要开发 payload 内部规则结构化编辑器。

---

## 9. 高级配置

折叠显示：

```text
path-in-bundle

size-limit

HTTP Header
```

Header 支持：

```text
Key
Values[]
```

例如：

```text
User-Agent
mihomo

Authorization
Bearer xxx
```

---

## 10. behavior / format 联动

MRS 只允许：

```text
domain
ipcidr
```

当：

```text
format = mrs
```

禁用：

```text
classical
```

用户主动从 domain 切到 classical，而当前是 MRS：

```text
自动 mrs → yaml
```

并提示：

```text
Classical 不支持 MRS，已切换为 YAML
```

---

## 11. Provider Validation

新增：

```text
PROVIDER_NAME_EMPTY
PROVIDER_NAME_DUPLICATE

PROVIDER_HTTP_URL_EMPTY
PROVIDER_HTTP_URL_INVALID

PROVIDER_FILE_PATH_EMPTY

PROVIDER_INLINE_PAYLOAD_EMPTY

PROVIDER_INTERVAL_INVALID

PROVIDER_PATH_DUPLICATE

PROVIDER_MRS_CLASSICAL_INVALID

PROVIDER_PROXY_MISSING
```

Warning：

```text
RAW_RULE_PROVIDER
RULE_PROVIDER_UNUSED
RULE_PROVIDER_UNKNOWN_FIELDS
```

Validation 继续进入现有：

```text
VisualIssue
```

体系。

---

## 12. Provider.proxy

Provider Dialog 的下载代理：

```text
DIRECT
代理组列表
```

如果原 YAML 是无法识别的字符串：

```text
raw value
```

可显示警告。

Structured Provider 使用：

```ts
groupId
```

因此 Group 重命名不需要修改 Provider 状态。

---

## 13. 删除 Proxy Group

扩展现有：

```ts
groupReferences()
```

除：

```text
groups
rules
```

之外增加：

```text
ruleProviders
```

如果：

```yaml
proxy: 节点选择
```

引用该 Group：

禁止删除。

提示：

```text
该代理组被 2 个规则集数据源用作下载代理
```

---

## 14. RAW Provider

RAW Card：

```text
cn_domain

高级 YAML

该数据源使用 YAML Anchor、Merge
或其他高级语法。

请切换到 YAML 模式修改。
```

允许：

```text
查看
无引用时删除
```

禁止：

```text
普通表单编辑
```

---

## 15. 新建 Provider

增加：

```ts
newRuleProvider()
```

默认：

```ts
{
  type: 'http',
  behavior: 'domain',
  format: 'mrs',
  interval: 86400,
  url: '',
}
```

Name 使用：

```ts
uniqueProviderName()
```

保证唯一。

---

## 16. 阶段二完成标准

必须实现：

```text
✓ Provider Section

✓ HTTP 创建/编辑

✓ FILE 创建/编辑

✓ INLINE 创建/编辑

✓ behavior / format 联动

✓ Provider Validation

✓ Provider.proxy 可选代理组

✓ Group 删除考虑 Provider.proxy

✓ RAW Provider 不可误改

✓ Visual → YAML 能立即正确更新
```

完成后进入阶段三。

---

# 第二部分：实施方案三——RULE-SET 可视化与引用闭环

## 1. 阶段目标

让 `RULE-SET` 正式成为 Visual Rules 的一等规则类型。

最终完成：

```text
Rule Provider
      ↓
RULE-SET
      ↓
Proxy Group
```

完整可视化引用关系。

---

## 2. 扩展当前 RuleMatcher

不要创建新的 Rule 编辑体系。

继续复用：

```text
RuleList
RuleCard
RuleDialog
RuleMatcher
```

RuleMatcher 变成：

```text
MATCH
→ 无 matcher value

RULE-SET
→ RuleProviderCombobox

GEOSITE / GEOIP
→ GeoMatchValueCombobox

其他
→ Input
```

---

## 3. RuleProviderCombobox

显示：

```text
cn_domain
Domain · MRS · HTTP

cn_ip
IPCIDR · MRS · HTTP

custom
Classical · YAML · File
```

搜索至少支持：

```text
name
behavior
format
```

保存：

```text
providerId
```

不是 name。

---

## 4. RuleCard

显示：

```text
RULE-SET    cn_domain
            Domain · MRS

                 →

             国内直连
```

Inline 编辑：

```text
[RULE-SET ▼]
[cn_domain ▼]
→
[国内直连 ▼]
```

---

## 5. RuleDialog

当：

```text
type = RULE-SET
```

Matcher 区域替换为：

```text
规则集数据源
[cn_domain ▼]
```

Provider 不存在：

```text
暂无规则集数据源
```

并提示用户先创建。

---

## 6. 无效 Provider 引用

导入：

```yaml
RULE-SET,missing_provider,DIRECT
```

不要变 RAW Rule。

显示：

```text
RULE-SET
missing_provider ⚠
→ DIRECT
```

Validation：

```text
RULE_SET_PROVIDER_MISSING
```

用户选择合法 Provider 后恢复正常。

---

## 7. no-resolve

抽离统一方法：

```ts
canUseNoResolve(rule, ruleProviders)
```

规则：

```text
GEOIP
true

IP-CIDR
true

IP-CIDR6
true

RULE-SET + ipcidr
true

RULE-SET + classical
true

RULE-SET + domain
false

其他
false
```

不要继续让：

```text
RuleCard
RuleDialog
Validation
```

分别硬编码。

---

## 8. Provider 切换

例如：

```text
RULE-SET cn_ip
no-resolve = true
```

切换到：

```text
cn_domain
```

必须自动：

```ts
noResolve = false
```

避免生成无意义配置。

---

## 9. 新建 RULE-SET

当存在 Provider 时：

```text
选择 RULE-SET
↓
默认选第一个 Provider
```

当没有 Provider：

```text
provider = empty/raw
```

提示：

```text
请先创建规则集数据源
```

不要偷偷创建 Provider。

---

## 10. 类型切换

从：

```text
DOMAIN-SUFFIX
→ RULE-SET
```

不要保留旧：

```text
value
```

反向：

```text
RULE-SET
→ DOMAIN
```

新：

```text
value = ''
```

不要把 Provider 名称当 DOMAIN value。

---

## 11. Provider References

增加：

```ts
ruleProviderReferences(draft, providerId)
```

用于：

```text
Provider Card 引用计数

Provider 删除保护

Validation
```

例如：

```text
cn_domain
3 条规则引用
```

---

## 12. 删除 Provider

如果存在：

```text
RULE-SET → providerId
```

禁止删除。

提示：

```text
该规则集数据源被 3 条分流规则引用，
请先修改或删除相关规则。
```

不要自动级联删除规则。

---

## 13. Provider 重命名

Structured RULE-SET 保存：

```text
providerId
```

所以 Provider：

```text
cn_domain
→
china_domain
```

不需要修改 RuleDraft。

Serializer 自动：

```text
providerId
→ china_domain
```

输出：

```yaml
RULE-SET,china_domain,DIRECT
```

---

## 14. RAW Rule 潜在引用

RAW Rule 可能存在：

```yaml
AND,((RULE-SET,cn_domain),(NETWORK,TCP)),Proxy
```

增加：

```ts
findPotentialRawProviderReferences()
```

删除 Provider 前如果发现潜在引用：

```text
禁止直接删除
```

提示：

```text
该数据源可能被高级规则引用，
请先检查 YAML。
```

不要全局 string.replace。

---

## 15. Provider 重命名与 RAW Rule

如果现有 RAW Rule Parser 能够安全识别：

```text
RULE-SET,<name>
```

可以做精确 token 替换。

无法可靠解析：

```text
保持原内容
+
Warning
```

原则：

```text
宁可要求检查 YAML
也不要误改高级规则
```

---

## 16. Rules 排序

RULE-SET 按普通非 MATCH 规则处理。

新增 RULE-SET：

```text
插到 MATCH 前
```

现有：

```text
MATCH 置底
拖拽排序
```

行为保持不变。

---

## 17. GEO provider prop 重命名

现有 Rule 组件里的：

```ts
provider
```

实际上是 Geo Provider。

现在存在：

```text
Geo Provider
Rule Provider
```

为避免混乱，统一重命名：

```ts
provider
→
geoProvider
```

涉及：

```text
VisualTemplateEditor
RuleList
RuleCard
RuleDialog
RuleMatcher
GeoMatchValueCombobox 调用链
```

只重命名，不修改功能。

---

## 18. 最终 Validation

增加：

```text
RULE_SET_PROVIDER_MISSING

RULE_SET_RAW_PROVIDER_REFERENCE

RULE_SET_NO_RESOLVE_INVALID
```

并把 Provider Issues 定位到：

```text
providerId
```

Rule Issues 定位到：

```text
ruleId
```

---

## 19. 最终验收配置

以下内容必须完全可视化：

```yaml
proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - DIRECT

  - name: 国内直连
    type: select
    proxies:
      - DIRECT
      - 节点选择

rule-providers:
  private_domain:
    type: http
    behavior: domain
    format: mrs
    url: https://example.com/private.mrs
    interval: 86400

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
  - RULE-SET,private_domain,DIRECT
  - RULE-SET,cn_domain,国内直连
  - RULE-SET,cn_ip,国内直连,no-resolve
  - MATCH,节点选择
```

并验证：

```text
✓ Provider 重命名，RULE-SET 自动跟随

✓ Group 重命名，Provider.proxy 自动跟随

✓ Provider 被引用时无法删除

✓ Group 被 Provider 使用时无法删除

✓ domain RULE-SET 不允许 no-resolve

✓ ipcidr RULE-SET 支持 no-resolve

✓ RULE-SET 可以拖拽排序

✓ 新 RULE-SET 插到 MATCH 前

✓ 悬空 Provider 引用能够修复

✓ RAW Rule 不被误修改

✓ YAML / Visual 往返不破坏现有配置
```

---

# 三个阶段的最终任务边界

```text
阶段一
解决“数据能不能正确读写”

阶段二
解决“Provider 能不能可视化维护”

阶段三
解决“Provider 能不能被 RULE-SET 安全消费”
```

严格保持这个职责划分。

不要在阶段一提前大量开发 UI，也不要在阶段二重新修改第一阶段的数据模型；如果阶段三发现核心模型无法支持引用，应优先修正模型，而不是通过字符串同步等临时方案绕过。
