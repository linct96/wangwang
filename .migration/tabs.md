# tabs

2026-10-05，engine（参照最新 shadcn base-nova golden pair）；已迁移。

## Changed

`src/components/ui/tabs.tsx`：Base UI Tabs；Trigger 改为 Tab，orientation 实际传给根组件。Radix import 扫描干净。

## Left alone

`src/features/nodes/node-dialogs.tsx` 的标签值及表单模式未改。

## Behavior changes

Base UI 默认手动激活：方向键移动焦点，Enter/空格确认；Radix 默认随焦点激活。未静默添加 activateOnFocus。

## Verify by hand

检查点击切换，方向键仅移动焦点，再按 Enter 切换。隔离浏览器已验证该键盘行为。
