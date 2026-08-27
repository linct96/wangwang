# Wangwang MVP 技术设计

## 1. 技术栈

- 前端：React SPA、Vite、React Router、原生 CSS。
- Worker：Hono、Zod、Cloudflare Workers Static Assets。
- 数据：D1 + `drizzle-orm/d1`，KV 仅缓存已生成配置。
- 后台任务：Cloudflare Queue；定时扫描暂不启用。
- 测试：Vitest + `@cloudflare/vitest-plugin`。

项目保持单仓库、单 Worker，不拆分服务或共享包。

## 2. 运行架构

```text
/admin/*              Cloudflare Access -> SPA / Hono API
/s/:profile/:token    Hono -> D1 元数据 -> KV/D1 YAML
手动刷新               查询节点源 -> Queue
Queue                  下载/解析/去重 -> D1 -> 重新生成配置
```

同一自定义域名下，Access 同时保护 `/admin` 与 `/admin/*`。`workers_dev` 在生产关闭，避免绕过 Access。

## 3. 数据模型

- `sources`：来源类型、URL/手动内容、刷新周期、条件请求头、状态与错误。
- `nodes`：SHA-256 指纹、协议、服务器、端口、完整配置 JSON、别名、标签、启停。
- `source_nodes`：来源和全局节点的多对多关系，保存原始名称与顺序。
- `profiles`：选择条件、规则、DNS 模式、令牌版本、编译版本和最后可用 YAML。
- `profile_sources`：配置引用的来源。
- `profile_node_exclusions`：配置显式排除的节点。
- `jobs`：刷新和生成任务的状态、错误与时间。

刷新成功时在 D1 事务内替换 `source_nodes`；刷新失败不修改旧关系。无来源引用的节点在成功刷新后删除。

## 4. 解析与去重

输入按以下顺序检测：Mihomo YAML `proxies`、Base64 URI 列表、普通 URI 列表。

- YAML 使用 `yaml` 包并限制 alias 数量。
- URI 解析使用标准 `URL`、`atob`/`btoa` 和 `TextDecoder`。
- 指纹不包含节点名称，包含协议、服务器、端口、认证和传输参数的规范化 JSON。
- 指纹使用 Web Crypto SHA-256，日志不输出原始连接配置。
- 同一来源内重复节点只保留第一次出现的位置。

## 5. Mihomo 生成

生成器按稳定顺序输出：基础设置、DNS、代理节点、代理组、规则。

- `节点选择` 包含自动选择、故障转移、全部节点和 `DIRECT`。
- `自动选择` 使用 `url-test`，`故障转移` 使用 `fallback`。
- 测试地址为 `https://www.gstatic.com/generate_204`，间隔 300 秒。
- 节点名称冲突时按稳定顺序添加 `-2`、`-3` 后缀。
- 零节点或输出超过 1 MiB时生成失败，不覆盖上一版本。

## 6. API

管理接口统一位于 `/api`：

- `GET/POST /sources`，`PATCH/DELETE /sources/:id`。
- `POST /sources/:id/refresh` 返回 `202` 和 `jobId`。
- `GET /nodes`，`PATCH /nodes/:id`，`PATCH /nodes/batch`。
- `GET/POST /profiles`，`GET/PATCH/DELETE /profiles/:id`。
- `POST /profiles/:id/compile`、`POST /profiles/:id/rotate-token`。
- `GET /jobs/:id`。

公开接口为 `GET /s/:profileId/:token/config.yaml`。成功返回 `text/yaml` 和 `Cache-Control: no-store`。

响应格式为 `{ "data": ... }` 或 `{ "error": { "code": "...", "message": "..." } }`。异步操作返回 HTTP 202。

## 7. 后台任务与缓存

Queue 消息仅包含 `{ jobId, type, entityId }`，类型为 `refresh_source` 或 `compile_profile`。消费逻辑按任务状态幂等，业务错误写入 `jobs` 后确认消息，运行时错误由 Queue 默认重试。

节点源通过手动刷新入队；刷新成功后，将引用该来源的配置依次入队生成。

KV 使用不可变键 `profile:{id}:revision:{revision}`。订阅请求先从 D1 获取当前版本和令牌版本，再读 KV；KV 未命中时回退 D1 并回填。

## 8. 安全

- 管理 API 使用 D1 中的管理员账号和 HttpOnly Session Cookie 认证。
- 修改请求校验 `Origin` 与当前 Host 一致，不开放跨域访问。
- 订阅令牌为 `HMAC-SHA256(profileId:tokenVersion)`，密钥使用 Wrangler Secret。
- URL 源仅允许 HTTP/HTTPS，禁止用户信息、localhost、`.local` 和私网 IP 字面量。
- 最多跟随 3 次重定向，每次重新验证 URL；请求超时 15 秒，流式限制 1 MiB。
- D1 按个人部署约定明文保存来源 URL和节点配置；UI、错误和日志必须脱敏。

## 9. Cloudflare 绑定

- D1：`DB`
- KV：`KV`
- Queue producer/consumer：`JOBS`
- Static Assets：`ASSETS`
- 变量：无。Worker 允许所有绑定到它的域名访问，管理接口由应用账号保护。
- 订阅令牌：在 `worker/security.ts` 中手动设置。

本地开发使用占位值；生产部署前创建真实 D1、KV、Queue、自定义域名和 Access 应用。
