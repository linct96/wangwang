# AGENTS.md

## 代码提交

- 提交前按功能模块拆分改动，每个 commit 保持合理粒度。
- commit 信息遵循项目现有风格，使用 `type(scope): 描述`；无明确模块时省略 `scope`。

## 代码推送

- 每次执行 `git push` 前，必须先运行 `pnpm format`。
- 仅在格式化成功后推送代码，并将格式化产生的改动一并提交。
