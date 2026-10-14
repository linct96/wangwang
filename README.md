# Wangwang

React SPA + TanStack Router + Tailwind CSS + shadcn/ui + Sonner + Hono + Drizzle ORM，部署到 Cloudflare Workers。

## 开发

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
```

开发模式由 Cloudflare Vite Plugin 启动本地 Worker，前端 API 统一请求本地 Worker。首次开发或重建本地数据库时执行 `pnpm db:migrate:local`，数据结构和初始化的 `system-manual` 节点源均来自正式 D1 baseline。

本地绑定来自 `wrangler.jsonc`：D1 `DB`、KV `KV`、Queue `JOBS`、静态资源 `ASSETS`。本地 Worker 密钥放在 `.dev.vars`（可复制 `.dev.vars.example`）。

- 前端：`src/`
- Worker API：`worker/`
- 健康检查：`GET /healthz`
- 独立部署向导：见 `wangwang-wizard` 仓库（浏览器直连 Cloudflare API）

## D1

创建远程数据库后，将返回的 `database_id` 写入 `wrangler.jsonc`：

```bash
pnpm wrangler d1 create wangwang-db
pnpm cf-typegen
```

正式上线的初始化基线为 `drizzle/0000_initial.sql`，一次创建完整表结构、约束、索引及 `system-manual` 节点源。Drizzle 只保留对应的初始快照；后续表结构变更通过 `pnpm db:generate` 生成增量迁移。

开发期迁移链已合并。已有数据库不能直接应用新基线，必须先清空或重建，同时清理 `d1_migrations` 迁移记录；此操作会删除账号、节点、模板及配置数据。使用新建的远端 D1 时，更新 `database_id` 后执行 `pnpm db:migrate:remote`。重建本地数据库后，重启开发服务并重新初始化管理员。

## 订阅索引与密钥更换

订阅地址格式不变。分发请求先校验 token 格式，再以 SHA-256 摘要唯一索引查询一个 Profile，检查启用状态并执行最多一次 HMAC 校验，直接返回 D1 中的最新 YAML。无效格式不访问 D1，未命中不回退全表扫描；禁用、删除、轮换 token 仍由数据库当前状态决定，不使用 KV 授权缓存。

新配置和 token 轮换会同时保存摘要。读取配置只生成订阅地址，不修改索引。更换 `SUBSCRIPTION_TOKEN_SECRET` 后，旧地址立即失效；在登录后的同源页面控制台显式重建索引，再使用后台生成的新地址：

```js
const response = await fetch('/api/profiles/reindex-tokens', { method: 'POST' })
if (!response.ok) throw new Error(await response.text())
console.log(await response.json())
```

重建可重复执行，版本条件防止覆盖并发轮换。打开配置列表不自动修复索引。YAML 只读写 D1；KV 用于规则集目录。

## 原子刷新与任务重试

确认 Cloudflare 配置包含三个 Cron：每小时刷新 `0 * * * *`、任务恢复 `*/5 * * * *`、规则集同步 `17 3 * * *`；通过独立部署向导部署时也需要同步这些触发器。

刷新先下载、解析和校验，再用单次 D1 batch 提交节点、源信息与关联配置的编译任务记录。保留相同指纹节点的 ID、别名、启用状态和标签；失败不发布半份节点集合，新地址仅在提交成功后替换旧地址。刷新期间修改/停用/删除源会使旧结果无法提交。最多 2000 个全局节点；解析后的提交 JSON 超过 D1 的 2 MB 单字符串上限时直接拒绝，不回退到非原子分批写入。

临时网络错误、HTTP 408/429/5xx 和数据库/入队异常采用 5/10/20 秒退避，最多 4 次业务尝试；其他 HTTP 错误、无效 URL/订阅和明确超限直接结束。业务次数保存在 D1，定时重新投递不会重置次数。失败保留待验证地址供后续刷新使用。

已提交刷新后入队失败，只补发持久化的固定 ID 编译任务，不重新下载，也不会因 304 丢失通知。消息可能重复，但同一实体的活跃任务由租约互斥，终态消息只确认不执行；排队编译的 YAML 与任务终态也在同一个 batch 提交。未入队、投递丢失或执行崩溃的任务每 5 分钟检查恢复，崩溃租约在 16 分钟后到期。后台等待超时不取消任务，可以稍后查看任务列表。

回滚 Worker 前应暂停消费并处理完待分发任务，避免旧消费代码无法理解在途任务状态。

## 全部订阅源与订阅源槽位

订阅配置的「全部订阅源」支持多选已有订阅节点源，每个源生成一个 HTTP `proxy-providers`，供 `include-all` / `include-all-providers` 引入。它独立于「全部节点」，不展开本地缓存节点；不依赖模板声明订阅源槽位。仅允许已启用且有 URL 的订阅源，沿用源的更新间隔、User-Agent 和名称排除过滤。与订阅源槽位选择同一源时复用槽位 provider；已选源须先解除配置绑定才能停用或删除。原始订阅 URL 会写入最终配置，应按敏感信息保护。

模板的“节点源槽位”支持两种类型：节点槽位按源 / 标签 / 指定节点筛选并展开到 `proxies`；订阅源槽位由配置单选绑定一个已启用且有 URL 的订阅节点源，生成 HTTP `proxy-providers`，由代理组 `use` 引用，不展开本地缓存节点。同一模板和代理组可以混用，两种槽位的绑定彼此独立；同一订阅槽位被多组引用时复用一个 provider。

订阅源槽位使用稳定名称 `wangwang-<槽位标识后缀>` 与独立缓存路径。更新间隔、User-Agent、名称排除过滤沿用节点源，健康检查默认每 300 秒一次；不支持槽位级过滤或自定义 provider 参数。绑定源不存在、已停用、非 URL 或未绑定时拒绝生成；模板已有 provider 保留，生成名称冲突或生效的 `use` 引用不存在的 provider 时明确报错，不覆盖定义。`include-all` / `include-all-providers` 与显式 `use` 可以并存，遵循 Mihomo 以全部 provider 覆盖显式 `use` 的行为；编辑代理组弹窗仅提示告警，不阻止保存或预览。自动包含全部 provider 也计为引用订阅源槽位。

绑定修改、节点源参数修改及新 URL 刷新验证成功后，关联配置会重新生成。仅已被配置绑定的具体槽位不能切换类型；未绑定槽位可切换，代理组引用情况不决定此锁定。槽位 API 必须显式提供 `type: nodes` 或 `type: subscription`，不再接受缺省类型。模板预览使用示例订阅地址，配置 YAML 预览使用实际绑定地址；动态节点数量未知，不计入本地节点数量。

**最终 YAML 包含原始订阅 URL（可能含订阅密钥），请勿公开分享。** Mihomo 直接拉取上游，内容必须兼容其 provider；不自动转换订阅格式，本地节点别名、单节点停用与本地标签筛选不会同步。

部署前运行 `pnpm db:migrate:remote`（本地为 `pnpm db:migrate:local`），应用初始化基线及后续增量迁移，再部署 Worker。未选择「全部订阅源」时返回空列表。

## 测试

```bash
pnpm test       # 单次运行
pnpm test:watch # 开发时监听
```

Vitest 使用独立 Node 配置，测试集中放在 `tests/`，不启动 Cloudflare Worker，也不访问真实数据库或网络。

`tests/main-flow.test.ts` 保留 6 个主流程用例：URI / Base64 / YAML 订阅导入、内置模板生成配置、可视化编辑与节点槽位展开、订阅源槽位输出 provider。暂不覆盖登录、D1 持久化、队列调度和大量边界情况。

## 验证与部署

```bash
pnpm format:check
pnpm lint
pnpm test
pnpm build
pnpm deploy
```
