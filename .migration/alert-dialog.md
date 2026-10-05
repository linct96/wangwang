# alert-dialog

2026-10-05，engine（参照最新 shadcn base-nova golden pair）；已迁移。

## Changed

`src/components/ui/alert-dialog.tsx`：Backdrop/Popup 替换旧部件；Cancel 使用 Close render Button，Action 使用普通 Button。保留原布局。Radix import / asChild 扫描干净。

## Left alone

`src/components/app-primitives.tsx` 中确认流程仍由受控 open/busy 控制。

## Behavior changes

Action 不自动关闭，符合当前异步确认流程；Base UI 默认聚焦第一个可聚焦元素，而非强制 Cancel。当前确认对话框首个可聚焦元素是 Cancel，隔离浏览器已确认。

## Verify by hand

确认初始焦点、取消、确认后等待异步结果及 busy 时 Escape 不关闭。隔离浏览器已验证。
