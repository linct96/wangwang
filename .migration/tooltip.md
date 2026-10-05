# tooltip

2026-10-05，engine（参照最新 shadcn base-nova golden pair）；已迁移。

## Changed

- `src/components/ui/tooltip.tsx`：Base UI Provider delay；Portal > Positioner > Popup；更新箭头定位。
- `src/features/sources/page.tsx`、`src/features/templates/visual/groups/group-dialog.tsx`、`src/features/templates/visual/groups/member-editor.tsx`、`src/features/templates/visual/rules/rule-card.tsx`：render 替换 asChild；字段帮助可键盘聚焦。
- 上述文件 Radix import / asChild / Radix CSS 变量扫描干净。

## Left alone

提示文案及现有 Provider 入口未改。

## Behavior changes

Provider 默认延迟仍为 0；采用最新 shadcn 箭头间距 4px。

## Verify by hand

检查悬停、键盘聚焦与箭头方向。隔离浏览器验证提示打开。
