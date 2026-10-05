# progress

2026-10-05，engine（参照最新 shadcn base-nova golden pair）；已迁移。

## Changed

`src/components/ui/progress.tsx`：Base UI Root > Track > Indicator；value 交给根组件，宽度由原语计算。保留现有高度和颜色。Radix import 扫描干净。

## Left alone

`src/features/sources/page.tsx` 的流量计算未改。

## Behavior changes

补齐真实 aria-valuenow；原实现仅手动平移 Indicator，未向 Root 传 value。

## Verify by hand

检查 0/37/100% 及辅助技术语义。SSR 验证 aria-valuenow=37；隔离浏览器确认填充宽度为轨道约 37%。
