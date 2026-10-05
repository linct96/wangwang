# shadcn/ui Base UI 统一

2026-10-05：配置统一为 `base-nova`，组件保留现有 Nova 外观及本地裁剪。参照 shadcn 4.21.1 CLI 的最新组件 golden pair，手动合并 API 变化，未批量覆盖定制文件。

- `components.json`：CLI base=base，后续添加组件不会重新引入 Radix。
- `package.json` / `pnpm-lock.yaml`：shadcn 4.21.1、@base-ui/react 1.8.0；删除 radix-ui 及其依赖，锁文件不再包含 Radix 包。
- `src/components/ui/combobox.tsx`：原本已为 Base UI；改为子路径导入，保留本地 pointer-events/滚轮处理及裁剪。
- Sonner、CodeMirror、dnd-kit 等非 Radix/Base 竞争原语库保持不动；原生 Input/Field/Table 等 shadcn 组件无需迁移。
- `scripts/test-ui.mjs` 接入 `pnpm test`：单一库/API 扫描、显式表单按钮类型、首屏标签、半选/进度 SSR、分段选择空值及数字值。

## 验证

迁移前 `pnpm build` 通过。迁移后 build、test、lint 通过，lint 仍为 22 项既有 warning，无 error。

隔离 Vite + Ego 浏览器验证 Select、Switch、半选、分段、Menu、Popover、Tooltip、Tabs、标签添加/移除、真实节点表单、AppDialog 焦点返回、确认框 busy 保护和真实 LoginPage 提交。登录 API 使用内存模拟，不访问/修改项目数据库。1280/390 宽度检查；0 个运行时错误。未完成所有业务页面端到端测试。

## 行为差异

Tabs 默认手动激活（方向键移焦点，Enter/空格切换）；AlertDialog Action 由当前受控异步流程关闭。详情见对应组件报告。

未提交、推送或部署。扫描 `src/components/ui`：**0 wrappers remain on Radix**。
