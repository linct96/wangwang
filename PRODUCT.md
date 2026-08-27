# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

个人管理员，在 Cloudflare 上管理自己的节点源、节点池和 Mihomo 配置。

## Product Purpose

Wangwang 是自托管的个人节点与 Mihomo 配置管理工具。它将节点源导入统一节点池，生成完整 Mihomo 配置，并通过可轮换令牌的订阅链接交付。成功意味着管理员能稳定维护节点和配置，刷新或生成失败时仍可继续使用上一版本。

## Positioning

以 Cloudflare Workers 和 D1 为运行基础，将个人节点管理、Mihomo 配置生成和订阅发布整合为一个轻量、自托管的单管理员工具。

## Operating Context

核心流程为：导入节点源、维护统一节点池、创建配置、选择节点与规则、生成并使用订阅链接。管理后台位于 `/admin`，由 Cloudflare Access 保护；订阅接口 `/s/*` 通过不可猜测且可轮换的令牌公开访问。

## Capabilities and Constraints

- 节点源只管理远程订阅 URL；订阅内容可解析 Mihomo YAML 和节点 URI。
- 节点页面支持通过协议表单新增、编辑和删除单个手动节点。
- 支持节点去重、筛选、重命名、标签与启停管理。
- 生成包含默认代理组、规则模块和 DNS 设置的完整 Mihomo YAML。
- 刷新或生成失败时保留上一版本；令牌轮换后旧订阅链接立即失效。
- 中文界面，桌面优先并兼容移动端。
- 部署于 Cloudflare Workers，使用 D1 存储；仅支持一个管理员。
- MVP 不支持多用户、流量统计、链式代理、模板市场、Sing-box 输出、远程规则集、自定义 YAML、可视化规则编辑和在线测速。

## Brand Commitments

产品名称为 Wangwang。界面语言为中文。

## Evidence on Hand

- 产品需求：`docs/requirements.md`
- 技术设计：`docs/technical-design.md`
- 现有管理界面：`src/App.tsx`、`src/App.css`、`src/index.css`
- 现有品牌图像：`src/assets/hero.png`、`public/favicon.svg`
- 当前没有可用于产品宣传的客户案例、评价、媒体报道或性能数据；后续设计不得虚构。

## Product Principles

- 自托管优先，保持部署和运维边界清晰。
- 围绕个人管理员的高频管理任务优化，不引入多用户复杂度。
- 刷新与生成失败不破坏已有可用配置。
- 订阅访问简单，但令牌必须不可猜测且可立即轮换。
- 严守 MVP 范围，不提前扩展未确认能力。
