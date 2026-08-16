# Go

## 配置

| 项目 | 值 |
|---|---|
| 版本 | Go 1.22+ |
| 测试框架 | go test（标准库） |
| Linter | golangci-lint |
| 类型检查 | 编译器内置 |
| 编译期约束 | 无未使用变量/导入；接口隐式实现完整性；`go vet` 无警告 |

## 测试规范

- 文件：`*_test.go`（同包）
- 断言：`if got != want { t.Errorf(...) }` 或 `testify/assert`
- 组织：场景 ≥3 时必须表驱动测试
- Mock：接口 + 手写 stub；复杂场景用 `gomock`
- 命名：`Test<函数名>_<场景>`
- 可选：性能敏感代码附带 `Benchmark*`

## Linter 规则

- 必须通过 `gofmt`（强制）
- 导出名 PascalCase；未导出 camelCase；包名小写
- 每个 error 返回必须检查；不得 `_` 忽略（除非注释）
- 共享变量用 `sync.Mutex` 或 channel 保护
- 无循环导入；避免 `init()` 副作用
- 工具：`golangci-lint run` 启用 govet,errcheck,staticcheck,gosimple,ineffassign,unused — 零 error
