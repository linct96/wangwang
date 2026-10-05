# label

2026-10-05，engine（参照最新 shadcn base-nova golden pair）；已迁移。

## Changed

`src/components/ui/label.tsx`：Radix Label 改为 shadcn Base 版本的原生 label。Radix import 扫描干净。

## Left alone

FieldLabel 及其现有样式未改。

## Behavior changes

## Verify by hand

点击关联标签，检查输入框聚焦与复选框切换。
