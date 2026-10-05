# switch

2026-10-05，engine（参照最新 shadcn base-nova golden pair）；已迁移。

## Changed

`src/components/ui/switch.tsx`：改用 Base UI Switch，保留尺寸、状态样式及布尔回调。Radix import 扫描干净。

## Left alone

节点源/配置启停业务请求未改。

## Behavior changes

## Verify by hand

检查点击、空格切换和禁用态。隔离浏览器已验证受控值切换。
