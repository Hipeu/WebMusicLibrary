# TypeScript

## 配置

| 项目 | 值 |
|---|---|
| 版本 | TypeScript 5.x (strict mode) |
| 测试框架 | Jest / Vitest |
| Linter | ESLint (Airbnb) + Prettier |
| 类型检查 | tsc --noEmit（内置） |
| 编译期约束 | `tsc --noEmit --strict` 无错误 |

## 测试规范

- 文件：`<module>.test.ts` 或 `<module>.spec.ts`
- 异常断言：`expect(...).toThrow()`
- 生命周期：`beforeEach` / `afterEach`
- Mock：`jest.mock()` / `vi.mock()`，类型安全
- 异步：必须 `async/await`，禁止裸 callback
- 命名：`it('should <行为> when <场景>')`

## Linter 规则

- 禁止 `any`（必须时注释原因）；优先 `unknown` + type guard
- ES Modules；type-only import 用 `import type`
- Null 安全：optional chaining / nullish coalescing / type narrowing
- Promise 必须 await 或显式处理 rejection；无浮动 promise
- 工具：`eslint --max-warnings=0`（Airbnb + @typescript-eslint）
