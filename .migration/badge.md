# badge

2026-10-05，engine（参照最新 shadcn base-nova golden pair）；已迁移。

## Changed

`src/components/ui/badge.tsx`：Slot 改为 useRender + mergeProps，保留变体和样式。Radix import 扫描干净。

## Left alone

状态文案与页面调用未改。

## Behavior changes

自定义元素组合 API 改为 render；当前无 asChild 消费者。

## Verify by hand

检查节点状态及组合框中的标签外观。
