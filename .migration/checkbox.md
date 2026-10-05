# checkbox

2026-10-05，engine（参照最新 shadcn base-nova golden pair）；已迁移。

## Changed

- `src/components/ui/checkbox.tsx`：改用 Base UI Checkbox；保留半选横线，状态改为 data-indeterminate。
- `src/features/templates/visual/rule-set-presets/preset-dialog.tsx`：半选改为独立 indeterminate 属性，checked 保持布尔值。
- 上述文件 Radix import 扫描干净。

## Left alone

选中/批量选择的业务逻辑未改。

## Behavior changes

半选 API 变化，当前调用已全部适配。

## Verify by hand

检查全选、半选、取消全选及标签点击。SSR 检查 aria-checked=mixed；隔离浏览器验证半选切换。
