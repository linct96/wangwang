# 内置模板

本目录中的 `.yaml` / `.yml` 文件由 Vite 自动收集并打包进 Worker，线上变更需要重新构建部署。
文件名生成模板 ID，例如 `minimal.yaml` 对应 `builtin:minimal`。文件名使用小写字母、数字、下划线或连字符，并以字母或数字开头。

每个文件通过 YAML Front Matter 保存元数据，第二个 `---` 之后是 Mihomo 配置正文：

```yaml
---
name: 示例模板
description: 基础分流
order: 4
---
proxy-groups:
  - name: 节点选择
    type: select
    include-all-proxies: true
    include-all-providers: true
rules:
  - MATCH,节点选择
```

`name` 必填。`description` 默认空字符串，`order` 默认 `0`。
模板先按 `order` 升序排列，同序时按 ID 排列。内置模板不声明槽位，复制为自定义模板后再按需配置。

加载时分别校验元数据和 YAML 正文，正文保持原样，元数据不会写入最终订阅。
内置模板只允许预览和复制；配置只能使用复制后的自定义模板。
