# Java

## 配置

| 项目 | 值 |
|---|---|
| 版本 | Java 17+ (LTS) |
| 测试框架 | JUnit 5 + Mockito |
| Linter | Checkstyle + SpotBugs + PMD |
| 类型检查 | 编译器内置 |
| 编译期约束 | 受检异常全部处理；泛型边界正确；`@Override` 一致 |

## 测试规范

- 文件：`*Test.java`（src/test/ 镜像目录）
- 断言：AssertJ 链式断言
- 异常：`assertThrows(XxxException.class, () -> {...})`
- Mock：`@Mock` + `@InjectMocks`（Mockito）
- 组织：`@Nested` 分组 + `@ParameterizedTest`
- 命名：`@DisplayName("should <行为> when <场景>")`

## Linter 规则

- Google Java Style 或项目 Checkstyle 配置
- `@Nullable`/`@NonNull` 注解；`Optional` 替代 null 返回
- 禁止空 catch；禁止过宽 `catch (Exception e)`
- 所有 `Closeable`/`AutoCloseable` 用 try-with-resources
- 局部变量/参数优先 `final`；DTO 优先 `record`
- 工具：Checkstyle + SpotBugs + PMD — 全部零 error
