# button

2026-10-05，engine（参照最新 shadcn base-nova golden pair）；已迁移。

## Changed

- `src/components/ui/button.tsx`：改用 Base UI Button，保留尺寸、变体和样式。
- `src/features/auth/page.tsx`、`src/features/nodes/node-dialogs.tsx`、`src/features/profiles/profile-editor.tsx`、`src/features/sources/page.tsx`：显式声明提交按钮。
- `src/features/profiles/page.tsx`、`src/features/templates/editor.tsx`：链接/文件导入使用 render + nativeButton=false。
- `src/components/app-primitives.tsx`：IconButton 可作为 render 的空壳传入。
- 上述文件 Radix import / asChild 扫描干净。

## Left alone

其他按钮尺寸、页面布局及业务请求未改。

## Behavior changes

Base UI 默认 type=button；现有表单提交入口已显式补齐 type=submit。

## Verify by hand

点击登录/保存，检查提交；检查禁用链接、文件导入和菜单触发器。隔离浏览器已验证真实 LoginPage 提交（模拟 API）及 IconButton 菜单。
