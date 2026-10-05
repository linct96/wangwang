# toggle-group

2026-10-05，engine（参照最新 shadcn base-nova golden pair）；已迁移。

## Changed

- `src/components/ui/toggle-group.tsx`：Base UI ToggleGroup + Toggle；保留内联变体以免增加未使用包装。
- `src/components/ui/segmented.tsx`：单选值使用数组，忽略空选择，保留字符串/数字原值；样式使用 data-pressed。
- `src/features/nodes/node-form.tsx`：传输/安全单选值和回调适配数组。
- 上述文件 Radix import / asChild 扫描干净。

## Left alone

所有 Segmented 业务选项及布局未改。

## Behavior changes

单选 API 不再使用 type=single，value 始终为数组。

## Verify by hand

检查分段切换、重复点击不改变值及传输方式/安全类型。Node 回归覆盖空数组不误选首项与数字值；隔离浏览器验证实际节点表单。
