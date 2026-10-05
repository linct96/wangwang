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

## 订阅索引与升级

订阅地址格式不变。分发请求先校验 token 格式，再以 SHA-256 摘要唯一索引查询一个 Profile，检查启用状态并执行最多一次 HMAC 校验，直接返回 D1 中的最新 YAML。无效格式不访问 D1，未命中不回退全表扫描；禁用、删除、轮换 token 仍由数据库当前状态决定，不使用 KV 授权缓存。

升级已有部署时：

1. 执行 `pnpm db:migrate:remote`（本地用 `pnpm db:migrate:local`），应用 `0003_subscription_token_index.sql`。
2. 部署新版 Worker，登录管理后台并打开配置列表，自动回填所有配置的 token 摘要。也可在登录后的同源页面控制台执行下面的请求，独立回填索引：

   ```js
   const response = await fetch('/api/profiles/reindex-tokens', { method: 'POST' })
   if (!response.ok) throw new Error(await response.text())
   console.log(await response.json())
   ```

3. 确认原订阅地址能正常下载，再让客户端刷新。**迁移不能在 SQL 中计算带密钥的 token；部署后、回填完成前，未回填的旧订阅会返回 404。** 回填可重复执行，版本条件防止覆盖并发轮换。

新配置和 token 轮换会同时保存摘要，不需要再次回填。更换 `SUBSCRIPTION_TOKEN_SECRET` 后，旧地址会因 HMAC 校验失败而失效；重新执行回填（或打开配置列表），再使用后台生成的新地址。旧版 YAML KV 条目不再读写，KV 仍用于规则集目录。

## 验证与部署

```bash
pnpm format:check
pnpm lint
pnpm test
pnpm build
pnpm deploy
```

`pnpm test` 使用 Node 24 原生 TypeScript 与内存 SQLite，覆盖订阅索引迁移/回填、实际 SQL 索引计划与单行查询、HMAC 次数、创建/编译/禁用/删除/轮换、密钥变更及并发版本保护。不模拟 D1 网络和 batch 事务，不代表线上延迟或性能基准。
