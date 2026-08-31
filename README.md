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

## 验证与部署

```bash
pnpm format:check
pnpm lint
pnpm test
pnpm build
pnpm deploy
```
