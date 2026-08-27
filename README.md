# Wangwang

React SPA + TanStack Router + Tailwind CSS + shadcn/ui + Sonner + Hono + Drizzle ORM，部署到 Cloudflare Workers。

## 开发

```bash
pnpm install
pnpm dev
```

开发模式默认使用 `localStorage` 模拟 API，存储键为 `wangwang:dev:v1`。需要连接本地 Worker 时使用：

```bash
VITE_DATA_SOURCE=api pnpm dev
```

生产构建默认使用 Worker API。

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
pnpm lint
pnpm build
pnpm deploy
```
