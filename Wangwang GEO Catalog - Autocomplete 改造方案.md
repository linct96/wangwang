# Wangwang GEO Catalog / Autocomplete 改造方案

## 1. 实现目标

完善模板可视化编辑器中的 GEO 数据源识别与 GEOSITE / GEOIP 自动补全能力。

当前需要支持 4 种 GEO Provider：

```ts
type GeoProvider = 'metacubex' | 'metacubex-lite' | 'loyalsoldier' | 'custom'
```

最终行为：

```text
MetaCubeX Full
→ 使用 MetaCubeX Full catalog

MetaCubeX Lite
→ 使用 MetaCubeX Lite catalog

Loyalsoldier
→ 使用 Loyalsoldier catalog

Custom
→ 不提供 catalog，仅允许手动输入
```

核心要求：

> GEO autocomplete 必须跟随当前实际 GEO 数据源，不能所有数据源共用 MetaCubeX catalog。

---

# 2. 重构 GEO Source 模型

建议统一定义：

```ts
export type GeoProvider = 'metacubex' | 'metacubex-lite' | 'loyalsoldier' | 'custom'

export interface GeoSourceInfo {
  provider: GeoProvider
}
```

不再使用：

```ts
dataset: 'full' | 'lite'
```

区分 MetaCubeX Full / Lite。

因为在当前产品 UI 中：

```text
MetaCubeX Full
MetaCubeX Lite
Loyalsoldier
```

本身就是三个独立数据源预设，因此直接映射为独立 provider 更清晰。

---

# 3. Provider 识别

实现统一方法：

```ts
function inferGeoProvider(geoxUrl: GeoXUrlConfig): GeoProvider
```

或者根据实际项目结构继续保留：

```ts
inferGeoSource()
```

但返回值统一为：

```ts
{
  provider: GeoProvider
}
```

识别优先级必须是：

```text
metacubex-lite
↓
metacubex
↓
loyalsoldier
↓
custom
```

不要只根据：

```text
geosite.dat
geoip.dat
country.mmdb
```

等文件名判断。

必须根据 URL 中的：

- GitHub owner
- repository
- branch / release path
- 当前项目 preset 中使用的 URL 特征

判断实际 provider。

示例：

```ts
if (matchesMetaCubeXLite(url)) {
  return 'metacubex-lite'
}

if (matchesMetaCubeX(url)) {
  return 'metacubex'
}

if (matchesLoyalsoldier(url)) {
  return 'loyalsoldier'
}

return 'custom'
```

尤其注意：

> Lite 的判断必须在普通 MetaCubeX 之前执行。

---

# 4. 统一 GEO Catalog API

将当前 catalog API 扩展为 provider-aware：

```http
GET /api/geo/catalog?provider=metacubex&type=geosite

GET /api/geo/catalog?provider=metacubex&type=geoip

GET /api/geo/catalog?provider=metacubex-lite&type=geosite

GET /api/geo/catalog?provider=metacubex-lite&type=geoip

GET /api/geo/catalog?provider=loyalsoldier&type=geosite

GET /api/geo/catalog?provider=loyalsoldier&type=geoip
```

统一响应：

```ts
interface GeoCatalogResponse {
  provider: 'metacubex' | 'metacubex-lite' | 'loyalsoldier'

  type: 'geosite' | 'geoip'

  items: string[]

  updatedAt: string

  stale: boolean
}
```

其中：

```text
items
→ 自动补全选项

updatedAt
→ 当前 catalog 数据更新时间

stale
→ 是否正在使用过期缓存
```

Custom provider 不需要调用这个 API。

---

# 5. Provider 处理层

Worker 内部不要把所有逻辑继续堆在一个 route 中。

建议抽象：

```ts
async function getGeoCatalog(provider: GeoProvider, type: 'geosite' | 'geoip'): Promise<GeoCatalog>
```

内部：

```ts
switch (provider) {
  case 'metacubex':
    return getMetaCubeXCatalog(type)

  case 'metacubex-lite':
    return getMetaCubeXLiteCatalog(type)

  case 'loyalsoldier':
    return getLoyalsoldierCatalog(type)

  default:
    throw new UnsupportedGeoProviderError()
}
```

---

# 6. MetaCubeX Full

保留当前已有逻辑。

数据来源继续使用：

```text
MetaCubeX/meta-rules-dat
```

Full catalog 应对应 Full 数据集实际包含的：

```text
GEOSITE
GEOIP
```

字段。

不要改变现有 Full autocomplete 行为，只需要把它归入：

```ts
provider: 'metacubex'
```

---

# 7. MetaCubeX Lite

MetaCubeX Lite 必须拥有独立 catalog。

不要：

```text
metacubex-lite
→ 继续复用 Full catalog
```

因为 Lite 本身就是经过裁剪的数据集。

应该根据项目当前 Lite GEO 文件对应的数据源，获取 Lite 实际包含的：

```text
GEOSITE
GEOIP
```

字段列表。

最终：

```text
provider=metacubex-lite
```

只能返回 Lite 数据集中真实存在的选项。

否则会出现：

```text
Autocomplete 推荐某个 GEOSITE
↓
Full 数据中存在
↓
Lite 数据中不存在
↓
生成配置运行失败
```

所以 Full 与 Lite catalog 必须完全分离。

---

# 8. Loyalsoldier GEOIP Catalog

Loyalsoldier GEOIP 不需要下载和解析完整：

```text
geoip.dat
```

直接使用：

```text
Loyalsoldier/geoip
branch: release
directory: dat/
```

目录中的 `.dat` 文件名就是 GEOIP category。

例如：

```text
cn.dat
us.dat
sg.dat
private.dat
cloudflare.dat
cloudfront.dat
google.dat
telegram.dat
```

转换逻辑：

```ts
function normalizeGeoIpFilename(name: string) {
  return name.replace(/\.dat$/i, '').toLowerCase()
}
```

只保留：

```text
*.dat
```

忽略：

```text
README
目录
其他文件
```

最终返回：

```ts
[
  'cn',
  'us',
  'sg',
  'private',
  'cloudflare',
  'google',
  ...
]
```

执行：

```text
filter
→ normalize
→ deduplicate
→ sort
```

---

# 9. Loyalsoldier GEOSITE Catalog

Loyalsoldier GEOSITE 主要基于：

```text
v2fly/domain-list-community/data
```

因此第一版采用：

```text
domain-list-community 基础字段
+
Loyalsoldier 扩展字段
```

生成 catalog。

## 基础字段

读取：

```text
v2fly/domain-list-community
branch: master
directory: data/
```

目录文件名就是基础 GEOSITE category，例如：

```text
google
github
youtube
telegram
netflix
steam
category-games
category-ads-all
geolocation-cn
geolocation-!cn
```

不要读取文件内容，只读取目录字段即可。

---

# 10. Loyalsoldier 扩展 GEOSITE

为 Loyalsoldier 自己维护或生成的 category 建立显式常量。

例如：

```ts
const LOYALSOLDIER_EXTRA_GEOSITE = ['china-list', 'apple-cn', 'google-cn', 'win-spy', 'win-update', 'win-extra']
```

最终：

```ts
const items = uniqueAndSort([...domainListCommunityItems, ...LOYALSOLDIER_EXTRA_GEOSITE])
```

后续如果确认 Loyalsoldier 增加新的自定义 category，只需要维护这组扩展数据即可。

不要使用 MetaCubeX catalog 补充缺失字段。

---

# 11. GEOSITE `@attribute` 行为

例如：

```text
steam@cn
category-games@cn
```

这类值当前第一版不需要完整建立 attribute catalog。

Autocomplete 只需要提供：

```text
steam
category-games
```

但是输入框必须允许用户手动输入：

```text
steam@cn
category-games@cn
```

所以 catalog 只能用于：

> suggestion

不能用于：

> whitelist validation

即：

```text
Catalog 没有该值
≠
配置一定无效
```

因此不要阻止用户保存手动输入值。

---

# 12. Custom Provider

只要当前：

```text
geox-url
```

不是项目已知的 MetaCubeX / MetaCubeX Lite / Loyalsoldier URL，就认为：

```ts
provider = 'custom'
```

Custom 行为：

```text
不请求 GEO Catalog API

不显示 MetaCubeX autocomplete

不显示 Loyalsoldier autocomplete

保留普通输入框

允许任意手动值
```

可以显示轻量说明：

```text
当前使用自定义 GEO 数据源，无法自动确定可用规则，请手动输入。
```

不要显示错误状态，因为 Custom 是正常使用场景。

---

# 13. 前端 `useGeoCatalog`

将当前 hook 改成：

```ts
useGeoCatalog({
  provider,
  type,
})
```

参数：

```ts
interface UseGeoCatalogParams {
  provider: 'metacubex' | 'metacubex-lite' | 'loyalsoldier'

  type: 'geosite' | 'geoip'
}
```

Custom 不调用 hook。

例如：

```ts
const source = inferGeoSource(geoSettings)

const catalog =
  source.provider === 'custom'
    ? null
    : useGeoCatalog({
        provider: source.provider,
        type,
      })
```

实际 React 中不要条件调用 Hook。

应该设计成类似：

```ts
useGeoCatalog({
  provider: source.provider,
  type,
  enabled: source.provider !== 'custom',
})
```

例如：

```ts
interface UseGeoCatalogParams {
  provider: GeoProvider
  type: GeoCatalogType
  enabled?: boolean
}
```

Custom 时：

```ts
enabled: false
```

---

# 14. 修复前端 Promise Cache

如果当前实现类似：

```ts
const cache = new Map<string, Promise<GeoCatalogResponse>>()
```

必须修复 rejected Promise 永久缓存的问题。

缓存 key：

```ts
;`${provider}:${type}`
```

例如：

```text
metacubex:geosite
metacubex:geoip

metacubex-lite:geosite
metacubex-lite:geoip

loyalsoldier:geosite
loyalsoldier:geoip
```

请求失败：

```ts
request.catch(() => {
  cache.delete(cacheKey)
})
```

否则：

```text
第一次请求失败
↓
Rejected Promise 被缓存
↓
以后一直读取失败 Promise
↓
页面生命周期内无法恢复
```

也可以改成：

```text
只缓存 successful result
```

---

# 15. Worker Cache

GitHub 数据不要每次用户输入时重新请求。

缓存 key：

```text
geo-catalog:metacubex:geosite
geo-catalog:metacubex:geoip

geo-catalog:metacubex-lite:geosite
geo-catalog:metacubex-lite:geoip

geo-catalog:loyalsoldier:geosite
geo-catalog:loyalsoldier:geoip
```

建议策略：

```text
Fresh TTL
24 小时

Stale fallback
最多 7 天
```

读取流程：

```text
请求 catalog
      ↓
读取 cache
      ↓
cache 未过期
      ↓
直接返回
```

如果过期：

```text
请求 GitHub
   ↓
成功
   ↓
生成 catalog
   ↓
写入 cache
   ↓
返回 stale=false
```

失败：

```text
GitHub 获取失败
      ↓
是否存在旧 cache
      ↓
YES
→ 返回旧数据
→ stale=true

NO
→ 返回服务错误
```

---

# 16. Stale 状态 UI

当：

```ts
stale === true
```

autocomplete 仍然正常使用。

但展示轻量提示：

```text
正在使用缓存的 GEO 数据目录
```

如果有 `updatedAt`：

```text
GEO 数据目录更新于 2 天前
```

不要：

```text
禁用 autocomplete
阻止规则保存
弹阻断式错误
```

因为 stale 数据通常仍然可用。

---

# 17. GEO Combobox 行为

GEOSITE：

```text
用户聚焦输入框
↓
加载对应 provider 的 GEOSITE catalog
↓
输入关键字
↓
本地过滤
↓
展示 suggestion
```

GEOIP 同理。

不要每输入一个字符都：

```text
重新请求 Worker
```

API 返回完整 catalog 后，在浏览器端过滤即可。

如果条目非常多，可以限制显示：

```text
前 50 项匹配结果
```

但不要截断原始 catalog cache。

---

# 18. 数据标准化

所有 provider 返回 catalog 前统一执行：

```ts
function normalizeCatalogItems(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}
```

不要强制所有 GEOSITE 转小写，除非确认上游数据本身全部大小写无关。

对于 GEOIP，可以根据现有 Mihomo 行为继续统一成小写或项目当前约定格式。

最重要的是：

> 不要让不同 provider 使用不同的数据规范。

---

# 19. 推荐代码结构

基于当前项目目录调整即可，建议职责拆分为：

```text
src/features/templates/visual/geo/
  source.ts
  presets.ts

src/features/templates/visual/rules/
  geo-catalog.ts
  use-geo-catalog.ts
  geo-combobox.tsx
```

Worker：

```text
worker/geo/
  catalog.ts
  cache.ts

  providers/
    metacubex.ts
    metacubex-lite.ts
    loyalsoldier.ts
```

职责：

```text
source.ts
→ 当前 geox-url → GeoProvider

metacubex.ts
→ 获取 Full catalog

metacubex-lite.ts
→ 获取 Lite catalog

loyalsoldier.ts
→ 获取 Loyal GEOIP / GEOSITE catalog

cache.ts
→ Worker catalog cache

catalog.ts
→ 参数解析、provider 路由、统一响应
```

---

# 20. 不要实现的内容

当前版本不要增加以下复杂度：

```text
不要在普通请求中下载整个 geosite.dat

不要在普通请求中解析 protobuf DAT

不要完整扫描 GEOSITE attribute

不要把 catalog 当白名单

不要阻止自定义 GEOSITE/GEOIP 输入

不要为 Custom 数据源猜测 MetaCubeX/Loyalsoldier catalog

不要增加数据库表保存 catalog

不要重写现有 GEO 设置页面
```

本次任务聚焦于：

```text
数据源识别
+
正确 catalog
+
autocomplete 切换
+
缓存
```

---

# 21. 最终数据流

```text
用户选择 GEO 数据源
          ↓
      geox-url
          ↓
   inferGeoProvider()
          ↓
 ┌────────┬─────────────┬──────────────┬────────┐
 │        │             │              │        │
 ↓        ↓             ↓              ↓
Meta    Meta Lite   Loyalsoldier     Custom
CubeX
 │        │             │              │
 ↓        ↓             ↓              ↓
Full     Lite        Loyal           不请求
catalog  catalog     catalog         catalog
 │        │             │              │
 └────────┴──────┬──────┘              │
                 ↓                     │
          Geo autocomplete             │
                 │                     │
                 └──────────┬──────────┘
                            ↓
                       用户输入值
                            ↓
                        Rules Editor
```

---

# 22. 关键实现原则

必须遵守以下原则：

1. `metacubex` 与 `metacubex-lite` 是两个独立 Provider。
2. Full 与 Lite 不能共用 catalog。
3. Loyalsoldier 不再使用 MetaCubeX autocomplete。
4. Custom 不自动绑定任何第三方 catalog。
5. GEO catalog 只用于自动补全，不用于强制验证。
6. 用户始终可以手动输入 GEOSITE / GEOIP。
7. Catalog 请求必须有缓存。
8. 请求失败后必须允许重试。
9. GitHub 临时失败时优先返回 stale cache。
10. 不改变现有 GEO 配置最终生成的 YAML 结构。

本次改造的核心结果应该是：

```text
用户当前选择什么 GEO 数据源
↓
Rules 编辑器就使用对应数据源的真实字段目录
```

不要再通过文件名猜测 catalog，也不要让多个不同 GEO 数据源共用同一份自动补全数据。
