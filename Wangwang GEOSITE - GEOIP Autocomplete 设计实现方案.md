# Wangwang GEOSITE / GEOIP Autocomplete 设计实现方案

## 1. 目标

为 Wangwang 的规则可视化编辑器增加：

- `GEOSITE` 匹配值自动补全
- `GEOIP` 匹配值自动补全
- 根据当前 GEO 数据源自动选择 Full / Lite 数据集
- 支持远程更新，不在前端硬编码完整规则列表
- autocomplete 失败时仍允许用户自由输入
- 不改变现有 YAML / VisualDraft / RAW Rule 行为

最终体验：

```text
规则类型
GEOSITE

匹配值
┌──────────────────────────────┐
│ goo                          │
├──────────────────────────────┤
│ google                       │
│ google-cn                    │
│ google-gemini                │
└──────────────────────────────┘
```

GEOIP：

```text
规则类型
GEOIP

匹配值
┌──────────────────────────────┐
│ cl                           │
├──────────────────────────────┤
│ cloudflare                   │
│ cloudfront                   │
└──────────────────────────────┘
```

必须允许直接输入未出现在建议列表里的值。

---

# 2. 数据源

使用：

```text
MetaCubeX/meta-rules-dat
branch: meta
```

四个目录：

```text
完整 GEOSITE
geo/geosite/*.mrs

完整 GEOIP
geo/geoip/*.mrs

Lite GEOSITE
geo-lite/geosite/*.mrs

Lite GEOIP
geo-lite/geoip/*.mrs
```

不要解析：

```text
geosite.dat
geoip.dat
```

不要为了 autocomplete 下载这些二进制文件。

直接使用 `.mrs` 文件名作为可用匹配值。

例如：

```text
geo/geosite/google.mrs
→ google

geo/geosite/category-ads-all.mrs
→ category-ads-all

geo/geosite/steam@cn.mrs
→ steam@cn

geo/geoip/google.mrs
→ google

geo/geoip/cn.mrs
→ CN
```

文件名中的：

```text
@
!
-
_
```

全部保留。

---

# 3. 后端架构

不要让浏览器直接访问 GitHub API。

架构：

```text
MetaCubeX GitHub
      ↓
Cloudflare Worker
      ↓
Geo Catalog Cache
      ↓
/api/geo/catalog
      ↓
React
      ↓
本地 autocomplete
```

禁止：

```text
用户输入一个字符
→ 请求一次 GitHub
```

Autocomplete 搜索必须完全在浏览器本地完成。

---

# 4. GitHub 数据同步

## 4.1 推荐使用 Git Trees API

不要优先使用 GitHub Contents API。

原因：

Contents API 单目录存在数量限制，大型 GEOSITE 集合可能产生完整性风险。

使用 Git Tree 获取 `meta` 分支文件树，再筛选四个目录。

实现一个：

```ts
fetchGeoCatalog(): Promise<GeoCatalog>
```

流程：

```text
获取 MetaCubeX/meta-rules-dat
meta branch 当前 tree

↓

递归读取 tree

↓

筛选：

geo/geosite/*.mrs
geo/geoip/*.mrs
geo-lite/geosite/*.mrs
geo-lite/geoip/*.mrs

↓

生成 catalog
```

GitHub 请求必须带：

```http
Accept: application/vnd.github+json
User-Agent: wangwang
```

如果部署环境存在：

```text
GITHUB_TOKEN
```

则附带：

```http
Authorization: Bearer ...
```

但 Token 必须是可选的。

公共仓库在没有 Token 时也必须正常工作。

---

# 5. Catalog 数据结构

定义：

```ts
export interface GeoCatalog {
  version: 1

  source: {
    repository: 'MetaCubeX/meta-rules-dat'
    ref: 'meta'
    commit?: string
    fetchedAt: string
  }

  geosite: {
    full: string[]
    lite: string[]
  }

  geoip: {
    full: string[]
    lite: string[]
  }
}
```

例如：

```json
{
  "version": 1,
  "source": {
    "repository": "MetaCubeX/meta-rules-dat",
    "ref": "meta",
    "fetchedAt": "2026-08-30T08:00:00.000Z"
  },
  "geosite": {
    "full": ["apple", "category-ads-all", "cn", "google", "openai", "steam@cn", "youtube"],
    "lite": ["apple", "cn", "google", "openai", "youtube"]
  },
  "geoip": {
    "full": ["CN", "JP", "US", "cloudflare", "google", "telegram"],
    "lite": ["CN", "JP", "apple", "cloudflare", "google", "telegram"]
  }
}
```

---

# 6. Catalog 标准化

写成纯函数：

```ts
buildGeoCatalog(tree: GitTreeItem[]): GeoCatalogData
```

规则：

### GEOSITE

```text
google.mrs
→ google

steam@cn.mrs
→ steam@cn
```

不修改大小写以外的任何内容。

### GEOIP

两位 ASCII 国家/地区代码统一转大写：

```text
cn.mrs → CN
jp.mrs → JP
us.mrs → US
```

普通服务集合保持原值：

```text
google.mrs → google
cloudflare.mrs → cloudflare
telegram.mrs → telegram
```

判断：

```ts
if (/^[a-z]{2}$/i.test(value)) {
  return value.toUpperCase()
}
```

然后：

```text
去重
→ 排序
→ 输出
```

不要把：

```text
google
```

转换成：

```text
GOOGLE
```

---

# 7. Worker API

增加：

```http
GET /api/geo/catalog
```

支持：

```http
GET /api/geo/catalog?type=geosite&dataset=full
GET /api/geo/catalog?type=geosite&dataset=lite
GET /api/geo/catalog?type=geoip&dataset=full
GET /api/geo/catalog?type=geoip&dataset=lite
```

推荐返回：

```json
{
  "type": "geosite",
  "dataset": "full",
  "items": ["apple", "category-ads-all", "cn", "google", "openai"],
  "source": {
    "repository": "MetaCubeX/meta-rules-dat",
    "ref": "meta",
    "fetchedAt": "..."
  }
}
```

参数非法返回：

```http
400
```

不要 silently fallback。

---

# 8. 缓存策略

GitHub Catalog 不需要实时更新。

目标：

```text
正常刷新周期：24 小时
最长 stale 数据：7 天
```

优先复用 Wangwang 当前已有缓存设施。

如果没有已有缓存 abstraction：

使用：

```ts
caches.default
```

不要为了这个功能新增 D1 表。

逻辑：

```text
请求 catalog

↓

存在缓存且年龄 < 24h
→ 直接返回

↓

缓存 > 24h
→ 请求 GitHub 刷新

成功
→ 覆盖缓存

失败
→ 返回旧缓存
→ stale: true

↓

没有任何缓存 + GitHub 失败
→ 503
```

即：

> 宁可返回昨天的 catalog，也不要因为 GitHub 临时不可用导致 autocomplete 完全失效。

前端即使 API 503，也必须允许自由输入。

---

# 9. 不使用 gh-proxy 获取 Catalog

当前：

```text
https://gh-proxy.com/
```

继续用于：

```text
geoip.dat
geosite.dat
country.mmdb
GeoLite2-ASN.mmdb
```

实际文件下载。

Autocomplete catalog 不经过 gh-proxy。

Worker 直接请求：

```text
api.github.com
```

原因：

```text
GEO 文件下载
和
规则目录查询
```

是两套不同用途。

---

# 10. 前端目录设计

根据 Wangwang 当前 visual rules 结构新增：

```text
src/features/templates/visual/rules/
├── geo-match-value-combobox.tsx
├── use-geo-catalog.ts
├── geo-catalog.ts
└── geo-catalog.test.ts
```

如果项目已有统一 API hooks / query 目录，应遵循现有结构，不强制创建上述文件。

不要新增新的状态管理库。

不要新增新的 UI Framework。

---

# 11. GeoMatchValueCombobox

实现：

```tsx
<GeoMatchValueCombobox type="GEOSITE" value={value} onChange={setValue} dataset="full" />
```

以及：

```tsx
<GeoMatchValueCombobox type="GEOIP" value={value} onChange={setValue} dataset="lite" />
```

必须支持：

1. 输入
2. autocomplete
3. 键盘上下选择
4. Enter 确认
5. 鼠标选择
6. 自由输入
7. API Loading
8. API Error
9. Empty Result

优先复用项目现有：

```text
Popover
Command
CommandInput
CommandItem
```

如果已有 shadcn Combobox 模式，直接复用。

---

# 12. 搜索逻辑

不要调用服务端搜索 API。

Catalog 下载一次以后本地 filter。

实现纯函数：

```ts
searchGeoCatalog(
  items: string[],
  query: string
): string[]
```

排序优先级：

```text
1. 完全匹配
2. 前缀匹配
3. 包含匹配
4. 其它
```

忽略大小写。

例如：

```text
query = "goo"
```

排序：

```text
google
google-gemini
category-google-scholar
```

限制：

```text
最多显示 50 条
```

空搜索可以显示：

```text
常用/前 50 条
```

不要一次渲染全部几千条 DOM。

---

# 13. GEOIP 国家名称显示

Catalog value 保持：

```text
CN
JP
US
SG
```

UI 可以辅助显示：

```text
CN    中国
JP    日本
US    美国
SG    新加坡
```

不要引入国家名称 npm 包。

使用浏览器：

```ts
new Intl.DisplayNames(['zh-CN'], {
  type: 'region',
})
```

只有满足：

```ts
;/^[A-Z]{2}$/
```

时显示国家/地区名称。

例如：

```text
CN · 中国
JP · 日本
google
cloudflare
```

实际写入 YAML 的仍然只是：

```text
CN
```

---

# 14. Full / Lite 自动判断

增加：

```ts
type GeoDataset = 'full' | 'lite'
```

根据当前模板 `geox-url` 判断。

## GEOSITE

URL 包含：

```text
geosite-lite.dat
```

→

```text
lite
```

URL 包含：

```text
geosite.dat
```

→

```text
full
```

默认：

```text
full
```

---

## GEOIP

当：

```yaml
geodata-mode: true
```

检查：

```text
geox-url.geoip
```

包含：

```text
geoip-lite.dat
```

→ lite

其它 `geoip.dat`
→ full

当：

```yaml
geodata-mode: false
```

检查：

```text
geox-url.mmdb
```

包含：

```text
country-lite.mmdb
```

→ lite

其它 country/mmdb
→ full

---

# 15. 自定义 GEO URL

如果用户使用：

```yaml
geox-url:
  geoip: https://example.com/custom.dat
```

无法判断其实际内容。

不要假装 autocomplete 数据一定准确。

使用：

```text
dataset = full
```

作为建议数据，同时 UI 提示：

```text
当前使用自定义 GEO 数据源，建议列表可能与实际数据库不同
```

仍允许自由输入。

不要因为值不在 catalog 中而产生 Validation Error。

---

# 16. Rule Editor 集成

修改现有：

```text
rule-dialog.tsx
rule-card.tsx
```

或实际负责 Rule 匹配值输入的组件。

当前类型：

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

只有：

```text
GEOSITE
GEOIP
```

使用：

```text
GeoMatchValueCombobox
```

其它规则保持当前输入组件不变。

不要重构与本需求无关的 Rule Editor。

---

# 17. GEOSITE 行为

例如：

```text
规则类型：GEOSITE
匹配值：goo
```

展示：

```text
google
google-gemini
category-google-scholar
...
```

选择：

```text
google
```

VisualDraft：

```ts
{
  type: 'GEOSITE',
  value: 'google',
  target: 'Google'
}
```

最终：

```yaml
- GEOSITE,google,Google
```

必须正常支持：

```text
steam@cn
microsoft@cn
category-ai-!cn
geolocation-!cn
```

Autocomplete 不允许错误拆分：

```text
@
!
-
```

---

# 18. GEOIP 行为

例如：

```text
规则类型：GEOIP
匹配值：c
```

Lite Catalog 可以显示：

```text
CN · 中国
cloudflare
cloudfront
```

选择：

```text
CN
```

最终：

```yaml
- GEOIP,CN,DIRECT,no-resolve
```

现有 `no-resolve` 行为保持不变。

Autocomplete 不负责自动修改：

```text
no-resolve
```

---

# 19. Loading / Error UX

加载：

```text
正在加载 GEO 数据…
```

加载失败：

```text
无法加载建议列表，仍可手动输入
```

无结果：

```text
没有匹配建议
按 Enter 使用 “xxx”
```

例如用户输入：

```text
my-private-site
```

即使不存在于 Catalog：

```text
按 Enter 使用 "my-private-site"
```

必须允许保存。

Autocomplete 是辅助功能，不是 whitelist validator。

---

# 20. API Hook

实现类似：

```ts
useGeoCatalog({
  type,
  dataset,
})
```

要求：

```text
同一个 type + dataset
整个页面生命周期只请求一次
```

如果项目已经使用 TanStack Query：

```ts
queryKey: ['geo-catalog', type, dataset]
staleTime: 24h
```

如果没有 TanStack Query：

不要为了这个功能新增依赖。

使用项目已有 fetch/cache abstraction。

---

# 21. 测试要求

## 后端

至少测试：

### Tree → Catalog

输入：

```text
geo/geosite/google.mrs
geo/geosite/steam@cn.mrs
geo/geosite/readme.txt
geo/geoip/cn.mrs
geo/geoip/google.mrs
geo-lite/geoip/jp.mrs
```

期望：

```text
geosite.full:
google
steam@cn

geoip.full:
CN
google

geoip.lite:
JP
```

### 必测

- `.mrs` extension stripping
- `CN/JP/US` uppercase
- service name 不 uppercase
- `@` 保留
- `!` 保留
- duplicate 去重
- 非 `.mrs` 文件忽略
- GitHub 请求失败
- stale cache fallback
- invalid API query

---

## 前端

至少测试：

### 搜索

```text
google
google-gemini
category-google-scholar
```

输入：

```text
goo
```

排序应为：

```text
google
google-gemini
category-google-scholar
```

### 必测

- GEOSITE 使用对应 catalog
- GEOIP 使用对应 catalog
- Full/Lite detection
- 自由输入
- API error 后仍能输入
- unknown value 不产生 validation error
- `steam@cn` 不被拆坏
- 选择建议正确更新 RuleDraft
- GEOIP CN 保持 `CN`
- 切换规则类型不会污染其它 Rule 类型

---

# 22. 不做的内容

本次明确不做：

```text
解析 geosite.dat
解析 geoip.dat
Mihomo Controller GEO 查询
搜索具体 domain 是否属于某个 GEOSITE
搜索具体 IP 属于哪个 GEOIP
rule-provider autocomplete
ASN autocomplete
远程 fuzzy search API
GEOSITE 内容预览
GEO 数据管理页面
```

不要扩大任务范围。

---

# 23. 后续扩展接口预留

Catalog 类型建议定义：

```ts
type GeoCatalogType = 'geosite' | 'geoip'
```

不要现在加入：

```text
asn
rule-set
```

但代码结构应允许以后扩展：

```text
GeoCatalogType
→ geosite
→ geoip
→ asn
```

---

# 24. 验收标准

完成后必须满足以下场景。

### Case 1

选择：

```text
GEOSITE
```

输入：

```text
goo
```

可以看到：

```text
google
```

选择后生成：

```yaml
- GEOSITE,google,<target>
```

---

### Case 2

选择：

```text
GEOSITE
```

输入：

```text
steam@
```

完整数据集能够正确提供带 `@` 的可用条目；选择后原样保存。

---

### Case 3

当前配置：

```yaml
geodata-mode: true

geox-url:
  geoip: '.../geoip-lite.dat'
```

GEOIP autocomplete 使用：

```text
geo-lite/geoip
```

而不是完整 GEOIP catalog。

---

### Case 4

当前配置：

```yaml
geox-url:
  geosite: '.../geosite.dat'
```

GEOSITE 使用：

```text
geo/geosite
```

完整 catalog。

---

### Case 5

GitHub 不可访问。

Rule Editor：

```text
仍可以正常打开
仍可以手动输入
仍可以保存
```

只显示：

```text
建议列表暂时不可用
```

---

### Case 6

用户输入不存在于 Catalog 的：

```text
my-private-geosite
```

允许：

```text
Enter
→ 保存
```

不得出现 Error。

---

# 25. 实现顺序

严格按以下顺序：

```text
1. 检查 Wangwang 当前 API/router/cache 架构

2. 定义 GeoCatalog 类型

3. 实现 GitHub Tree → Catalog parser

4. 为 parser 编写测试

5. 实现 Worker catalog fetch + cache

6. 实现 /api/geo/catalog

7. 为 API/cache 编写测试

8. 实现 inferGeoDataset()

9. 为 dataset inference 编写测试

10. 实现 useGeoCatalog()

11. 实现 GeoMatchValueCombobox

12. 接入 RuleDialog / RuleCard

13. 补前端测试

14. 运行与本次改动直接相关的测试

15. TypeScript typecheck

16. lint

17. 不执行与本功能无关的大规模测试
```

---

# 26. 代码质量要求

必须遵守：

- 不重复定义 Catalog 类型
- 数据解析使用纯函数
- 后端 GitHub fetch 与 catalog parse 分离
- autocomplete search 使用纯函数
- 不在 React component 内写复杂数据转换
- 不硬编码完整 GEOSITE/GEOIP 列表
- 不新增数据库表
- 不新增状态管理库
- 不新增 UI 框架
- 不每次键盘输入请求网络
- 不改变现有 YAML source of truth 架构
- 不破坏 RAW Rule
- 不把 autocomplete 当作强制校验

---

# 27. 最终目标架构

```text
MetaCubeX/meta-rules-dat
            │
            │ GitHub Tree
            ▼
┌──────────────────────────┐
│ Wangwang Worker          │
│                          │
│ fetchGeoCatalog()        │
│ buildGeoCatalog()        │
│ cache 24h / stale 7d     │
└─────────────┬────────────┘
              │
              │ /api/geo/catalog
              ▼
┌──────────────────────────┐
│ useGeoCatalog()          │
└─────────────┬────────────┘
              │
              ▼
┌──────────────────────────┐
│ GeoMatchValueCombobox    │
│                          │
│ local search             │
│ free input               │
│ Full / Lite              │
└─────────────┬────────────┘
              │
              ▼
┌──────────────────────────┐
│ RuleDraft                │
│                          │
│ GEOSITE,google,...       │
│ GEOIP,CN,...             │
└─────────────┬────────────┘
              │
              ▼
           YAML
```

## 完成定义

本任务只有在以下全部完成后才算完成：

- Worker 能动态获取 Catalog
- Catalog 有缓存和失败降级
- Full/Lite 正确区分
- GEOSITE autocomplete 可用
- GEOIP autocomplete 可用
- 自由输入可用
- 当前 YAML 生成行为无回归
- parser/search/dataset detection 有单元测试
- 不依赖手工维护 GEO 列表
