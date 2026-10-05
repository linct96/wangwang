# dialog

2026-10-05，engine（参照最新 shadcn base-nova golden pair）；已迁移。

## Changed

`src/components/ui/dialog.tsx`：Overlay/Content 改为 Backdrop/Popup；关闭按钮使用 render。保留标题、宽度及滚动样式；Radix import / asChild 扫描干净。

## Left alone

AppDialog 和业务弹窗的现有组织结构未改。

## Behavior changes

## Verify by hand

检查焦点陷阱、Escape、关闭按钮、关闭后焦点回到入口及移动端滚动。隔离浏览器验证实际 AppDialog + ManualConnectionFields，1280/390 宽度检查及焦点返回。
