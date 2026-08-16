---
name: completion-rule
description: >
  大模型代码生成任务的自动自检与纠错规则。
  在代码输出后强制执行功能自测、单元测试设计和 Linter 检查。
  未通过则自动修正并循环，直到全部通过或达到最大迭代次数。
  适用于大模型生成或修改代码且要求正确、可测试、规范的场景。
  支持 Python、TypeScript、Go、Java，语言规则通过 references 加载。
---

# Completion Rule

## 角色

同时扮演三个角色：
1. **代码实现者** — 编写功能代码。
2. **自测工程师** — 设计测试、推演逻辑。
3. **代码审查员** — 检查规范与缺陷。

任一角色发现问题 = 未通过。

## 参数

使用前替换：

| 占位符 | 含义 |
|---|---|
| `<MAX_ITERATIONS>` | 最大循环次数（如 `3`） |
| `<TARGET_LANGUAGE>` | 目标语言（如 `Python 3.11+`） |
| `<TEST_FRAMEWORK>` | 测试框架（如 `pytest`） |
| `<LINTER_STANDARD>` | Lint 规范（如 `ruff`） |
| `<MIN_TEST_COVERAGE>` | 覆盖要求（如 `所有 public 函数：正向+异常`） |
| `<REQUIREMENT_REF>` | 需求描述位置 |

## 语言配置

根据目标语言读取对应 reference 文件：

| 语言 | 文件 |
|---|---|
| Python | `references/python.md` |
| TypeScript | `references/typescript.md` |
| Go | `references/go.md` |
| Java | `references/java.md` |

未列出的语言：选择社区主流工具，在输出中声明选择及理由。

## 流程

### 步骤1：实现

1. 按 <REQUIREMENT_REF> 完成代码，输出完整代码，不省略。
2. 一句话概述方案。

### 步骤2：功能自测

对照 <REQUIREMENT_REF> 检查：

| 维度 | 操作 |
|---|---|
| 需求覆盖 | 每条需求映射到代码位置 |
| 边界条件 | ≥3 个边界场景，逐一推演 |
| 逻辑推演 | ≥2 条正向路径，手动 trace |
| 数据流 | 验证初始化/变更/返回值全分支一致 |
| 编译期约束 | 按语言 reference |

输出：

```
[功能自测]
- 需求覆盖：PASS/FAIL
- 边界条件：PASS/FAIL
- 逻辑推演：PASS/FAIL
- 数据流：PASS/FAIL
- 编译期约束：PASS/FAIL/N/A
→ 总结：PASS/FAIL
```

### 步骤3：单元测试

使用 <TEST_FRAMEWORK> 及语言 reference 中的规范：

1. 编写测试：每个 public 函数 ≥1 正向、每个边界场景 1 个、≥1 异常路径。
2. 逐个测试对步骤1代码推演。
3. 对照 <MIN_TEST_COVERAGE> 评估覆盖。

输出：

```
[单元测试报告]
- 用例数：N，通过：M/N
- 覆盖：满足/不满足 <MIN_TEST_COVERAGE>
→ 总结：PASS/FAIL
```

输出完整测试代码。

### 步骤4：Linter 检查

按 <LINTER_STANDARD> 及语言 reference：

| 维度 | 检查 |
|---|---|
| 语法/编译 | 无错误 |
| 命名 | 符合规范 |
| 结构 | 函数 ≤50 行，嵌套 ≤3 层 |
| 类型 | public 签名有注解 |
| 安全/性能 | 无硬编码密钥，无性能陷阱 |
| 导入 | 无未使用，无循环 |
| 语言专项 | 按 reference |

输出：

```
[Linter 报告]
- 语法：PASS/FAIL
- 命名：PASS/FAIL
- 结构：PASS/FAIL
- 类型：PASS/FAIL/N/A
- 安全/性能：PASS/FAIL
- 导入：PASS/FAIL
- 语言专项：PASS/FAIL
→ 总结：PASS/FAIL
```

### 步骤5：修正循环

```
IF 全部 PASS → 步骤6
ELSE IF 迭代 < <MAX_ITERATIONS>:
  1. 汇总 FAIL（优先级：功能 > 测试 > 规范）
  2. 逐项：根因 → 修复 → 输出完整代码
  3. 代码变更则更新测试
  4. 从步骤2重新执行
  标记：[迭代 X/<MAX_ITERATIONS>]
ELSE → 步骤6 附风险说明
```

多语言任务：按语言独立执行步骤2-4，全部通过才算整体通过。

### 步骤6：最终输出

**全部通过：**

```
[结果：ALL PASS]
迭代次数：X/<MAX_ITERATIONS>
```

输出：最终代码 + 最终测试。

**达到上限：**

```
[结果：PARTIAL PASS]
迭代次数：<MAX_ITERATIONS>/<MAX_ITERATIONS>
遗留问题：[描述 + 影响 + 修复建议]
```

输出：最佳代码 + 最佳测试 + 风险说明。

## 约束

1. 每项检查必须显式输出 PASS 或 FAIL，禁止模糊表述。
2. 有 FAIL 必须执行修正，不得跳过。
3. 代码输出必须完整，禁止"同上""省略""..."。
4. 每轮迭代完整输出所有检查项，含已通过项。
5. 测试代码必须与功能代码同时输出。
