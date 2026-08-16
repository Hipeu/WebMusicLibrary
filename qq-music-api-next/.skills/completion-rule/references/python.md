# Python

## 配置

| 项目 | 值 |
|---|---|
| 版本 | Python 3.11+ |
| 测试框架 | pytest |
| Linter | ruff（默认规则） |
| 类型检查 | mypy --strict |
| 编译期约束 | N/A（解释型） |

## 测试规范

- 文件：`test_<module>.py`
- 异常断言：`pytest.raises`
- 数据管理：`@pytest.fixture`，禁止测试间状态耦合
- Mock：`unittest.mock.patch` 或 `pytest-mock`
- 命名：`test_<功能>_<场景>_<预期>`

## Linter 规则

- 导入顺序：stdlib → third-party → local；禁止 `import *`
- Docstring：所有 public 函数/类必须有（Google 或 NumPy 风格）
- 禁止裸 `except:`；禁止 mutable default arg；优先 f-string
- 工具：`ruff check --select=E,F,W,I,N,UP,B,A,S` 零 error
