# dropdown-menu

2026-10-05，engine（参照最新 shadcn base-nova golden pair）；已迁移。

## Changed

- `src/components/ui/dropdown-menu.tsx`：Base UI Menu，Portal > Positioner > Popup；Label 改为 GroupLabel，新增实际需要的 Group。
- `src/features/profiles/page.tsx`、`src/features/templates/visual/geo/geo-settings-panel.tsx`、`src/features/templates/visual/groups/member-editor.tsx`：render 触发器、菜单分组及链接项。
- 上述文件 Radix import / asChild / Radix CSS 变量扫描干净。

## Left alone

未添加未使用的子菜单、复选项和单选项。

## Behavior changes

## Verify by hand

检查键盘导航、Escape、触发器焦点返回及链接/操作项。隔离浏览器验证 IconButton 触发、操作回调和弹出分组。
