# Wangwang Wizard

这是独立的纯静态部署向导，不依赖 Wangwang 的 D1、KV、Queue。

## Cloudflare Pages

- GitHub 项目目录选择 `wizard/`
- 构建命令留空
- 输出目录填写 `.`
- 绑定 `wizard.wangwang.works.dev`

页面中的 API 请求由浏览器直接发送到 Cloudflare。Token 不会发给本项目 Worker。
