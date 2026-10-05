# popover

2026-10-05，engine（参照最新 shadcn base-nova golden pair）；已迁移。

## Changed

- `src/components/ui/popover.tsx`：Portal > Positioner > Popup，定位参数传给 Positioner。
- `src/features/templates/visual/groups/group-dialog.tsx`、`src/features/templates/visual/rule-providers/provider-combobox.tsx`：render 触发器；数据源宽度使用 --anchor-width。
- 上述文件 Radix import / asChild / Radix CSS 变量扫描干净。

## Left alone

图标与数据源搜索逻辑未改。

## Behavior changes

## Verify by hand

检查打开、搜索聚焦、Escape/外部点击及触发器宽度匹配。隔离浏览器验证宽度匹配和 Escape。
