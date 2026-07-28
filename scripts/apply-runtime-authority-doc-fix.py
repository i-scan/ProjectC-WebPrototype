from pathlib import Path
import re

SCRIPT_PATH = Path("scripts/apply-runtime-authority-doc-fix.py")
WORKFLOW_PATH = Path(".github/workflows/apply-runtime-authority-doc-fix.yml")


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, got {count}: {old[:80]!r}")
    write(path, text.replace(old, new, 1))


def replace_section(path: str, start: str, end: str, new_section: str) -> None:
    text = read(path)
    pattern = re.compile(re.escape(start) + r".*?(?=" + re.escape(end) + r")", re.S)
    new_text, count = pattern.subn(new_section.rstrip() + "\n\n", text, count=1)
    if count != 1:
        raise RuntimeError(f"Expected one section in {path}: {start!r} -> {end!r}, got {count}")
    write(path, new_text)


replace_once(
    "README.md",
    "TypeScript Shared Rule Core\n= 当前实际执行的费用、目标、效果、时序、环境和 Objective 算法语义\n\nGameState\n= 当前运行过程中的可变状态权威",
    "TypeScript Reference Implementation\n= 当前实际执行的费用、目标、效果、时序、环境和 Objective 参考行为\n\nGameState\n= 当前运行过程中的可变状态权威\n\n目标 Shared Rule Core\n= 下一阶段需要从 Square4 / Hex6 重复逻辑中提取的统一算法层，当前尚未完成",
)
replace_section(
    "README.md",
    "## 7. 配置与 Rule Core 接入顺序",
    "## 8. 历史规则文档",
    """## 7. 配置与 Rule Core 接入顺序

当前实际行为来源是 TypeScript Reference Implementation；Shared Rule Core 是尚未完成的目标层。

统一顺序：

```text
0. 从当前 TypeScript Reference Implementation 提取 Shared Rule Core
1. 直接重构 Schema，不保留旧结构兼容层
2. 拆分 Map Profile / Scenario 并更新 core-rules.v0.json
3. 更新引用校验、结构测试和现有行为基线
4. 建立 RuntimeRuleset Loader
5. 依次接入 Card Library、Actor / Equipment、Map Profile、Scenario
6. 建立 Initial GameState Factory
```

配置定义“是什么”，目标 Shared Rule Core 定义“如何执行”，GameState 保存“现在变成了什么”。

### Map Profile

负责 topology、尺寸、边界、Void、形状、Region 拼接和山脊、通口、障碍密度等几何生成参数与约束。

不包含具体 Actor、Objective、Resource、Shelter 实例或初始天气；这些属于 Scenario。

### Scenario

保存 Actor 实例与位置、Shelter、Objective、Resource、初始 Cell / Sky / Weather、任务、seed 和测试标签。

当前 ruleset 没有外部正式依赖；开始接入时直接使用新 Schema 和新 JSON 结构，不制作旧格式迁移表或兼容层。""",
)

replace_once(
    "AGENTS.md",
    "TypeScript Shared Rule Core\n= 当前实际执行的费用、目标、效果、时序、环境与 Objective 算法语义\n\nGameState\n= 当前运行过程中的可变状态权威",
    "TypeScript Reference Implementation\n= 当前实际执行的费用、目标、效果、时序、环境与 Objective 参考行为\n\nGameState\n= 当前运行过程中的可变状态权威\n\n目标 Shared Rule Core\n= 下一阶段需要从 Square4 / Hex6 重复逻辑中提取的统一算法层，当前尚未完成",
)
replace_section(
    "AGENTS.md",
    "## 5. Shared Rule Core 与配置接入",
    "## 6. 地图与表现不变量",
    """## 5. Shared Rule Core 与配置接入

当前 TypeScript Reference Implementation 是实际行为来源；Shared Rule Core 尚未实现，必须作为配置正式接入运行时的前置独立阶段，或配置接入 PR 的第一个阶段。

统一顺序：

```text
0. 提取 Shared Rule Core
1. 直接重构 Schema
2. 拆分 Map Profile / Scenario 并更新 JSON
3. 更新引用校验、结构测试和行为基线
4. RuntimeRuleset Loader
5. Card / Actor / Equipment / Map / Scenario 运行时接入
6. Initial GameState Factory
```

### 目标 Shared Rule Core

Square4 / Hex6 应共用 AP、支付退款、Damage / Shield、Card 目标和 Effect Handler、温度、环境反应、阶段和 Objective 更新；空间差异只通过 Topology Adapter 提供。

### RuntimeRuleset

业务模块通过统一 Loader 获取校验和 normalize 后的 RuntimeRuleset，不在组件中散落读取原始 JSON。当前无需为旧 Schema 增加兼容处理。

### Map Profile / Scenario

Map Profile 保存 topology、尺寸、边界、Void、形状、Region 拼接和几何生成参数；Scenario 保存具体 Actor、Objective、Resource、Shelter 实例、初始 Cell / Sky / Weather、任务、seed 和测试标签。

当前 ruleset 没有外部正式依赖，不建立旧格式迁移表或兼容层。""",
)

replace_once(
    "config/README.md",
    "TypeScript Shared Rule Core\n= 当前实际执行的规则算法语义\n\nGameState\n= 当前运行过程中的可变状态权威",
    "TypeScript Reference Implementation\n= 当前实际执行的规则算法与参考行为\n\nGameState\n= 当前运行过程中的可变状态权威\n\n目标 Shared Rule Core\n= 下一阶段需要提取的统一算法层，当前尚未完成",
)
replace_section(
    "config/README.md",
    "## 8. Shared Rule Core 与配置接入",
    "## 9. 当前迁移友好性边界",
    """## 8. Shared Rule Core 与配置接入

当前 TypeScript Reference Implementation 是实际行为来源；Shared Rule Core 尚未实现。

统一顺序：

```text
0. 从当前 Reference Implementation 提取 Shared Rule Core
1. 直接重构 core-rules.schema.json
2. 拆分 Map Profile / Scenario
3. 更新 core-rules.v0.json
4. 更新引用校验、结构测试和现有行为基线
5. 建立 RuntimeRuleset Loader
6. 依次接入 Card Library、Actor / Equipment、Map Profile、Scenario
7. 建立 Initial GameState Factory
```

当前 ruleset 没有外部正式依赖，不制作旧 Schema 迁移表、兼容加载器或长期 deprecated 字段层。

### Map Profile

负责 topology、尺寸、边界、Void、形状、Region 拼接，以及山脊、通口、障碍密度等几何生成参数和约束；不包含具体 Actor、Objective、Resource、Shelter 实例或初始天气。

### Scenario

负责使用的 Map Profile、seed、Actor 实例与位置、Shelter、Objective、Resource、兴趣点、初始 Cell / Ground / Sky / Weather、任务和测试标签。""",
)

if SCRIPT_PATH.exists():
    SCRIPT_PATH.unlink()
if WORKFLOW_PATH.exists():
    WORKFLOW_PATH.unlink()
