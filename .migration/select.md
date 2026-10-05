# select

2026-10-05，engine（参照最新 shadcn base-nova golden pair）；已迁移。

## Changed

- `src/components/ui/select.tsx`：Base UI Root，Positioner/Popup/List、GroupLabel、ScrollArrow；定位变量改为 Base UI 变量。
- `src/features/nodes/node-form.tsx`、`src/features/nodes/page.tsx`、`src/features/profiles/direct-node-binding-editor.tsx`、`src/features/profiles/profile-editor.tsx`、`src/features/sources/page.tsx`：items 首屏标签和 nullable 回调保护。
- `src/features/templates/visual/groups/group-dialog.tsx`、`src/features/templates/visual/rule-providers/provider-dialog.tsx`、`src/features/templates/visual/rule-set-presets/preset-dialog.tsx`、`src/features/templates/visual/rules/rule-card.tsx`、`src/features/templates/visual/rules/rule-target-select.tsx`、`src/features/templates/visual/sniffer/sniffer-settings-panel.tsx`：同样补齐 items、null 保护及所需分组。
- 上述文件 Radix import / asChild / Radix CSS 变量扫描干净。

## Left alone

业务枚举、标签文本及选项分组意图未改。

## Behavior changes

onValueChange 支持 null；当前单选业务忽略 null，而不是把它存入业务状态。未打开菜单时也显示选项标签，而不是内部 ID。

## Verify by hand

检查页面首屏标签、键盘选择/搜索、弹窗滚动和更换模板。SSR 验证首屏中文标签；隔离浏览器验证真实包装的选择及节点表单首屏值。
