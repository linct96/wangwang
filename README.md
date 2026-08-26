# Wangwang

React SPA + Vite + Hono + Drizzle ORM，部署到 Cloudflare Workers。

## 开发

```bash
pnpm install
pnpm dev
```

- 前端：`src/`
- Worker API：`worker/`
- 健康检查：`GET /healthz`
- 部署向导：`/wizard`（浏览器直连 Cloudflare API，不经过本 Worker）

## D1

创建远程数据库后，将返回的 `database_id` 写入 `wrangler.jsonc`：

```bash
pnpm wrangler d1 create wangwang-db
pnpm cf-typegen
```

## 验证与部署

```bash
pnpm lint
pnpm build
pnpm deploy
```
