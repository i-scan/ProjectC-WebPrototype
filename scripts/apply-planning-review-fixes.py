from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"Expected block not found in {path}: {old[:80]!r}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "README.md",
    "## 7. 配置与 Rule Core 接入顺序\n\n当前实际行为来源是 TypeScript Reference Implementation；Shared Rule Core 是尚未完成的目标层。\n\n统一顺序：\n\n```text\n0. 从当前 TypeScript Reference Implementation 提取 Shared Rule Core\n1. 直接重构 Schema，不保留旧结构兼容层\n2. 拆分 Map Profile / Scenario 并更新 core-rules.v0.json\n3. 更新引用校验、结构测试和现有行为基线\n4. 建立 RuntimeRuleset Loader\n5. 依次接入 Card Library、Actor / Equipment、Map Profile、Scenario\n6. 建立 Initial GameState Factory\n```",
    "## 7. 配置接入摘要\n\n当前实际行为来源是 TypeScript Reference Implementation；Shared Rule Core 是尚未完成的目标层。ProjectC `docs/runtime-data-integration-plan.md` 是正式阶段编号与完成标准的唯一来源；本 README 只保留依赖摘要：\n\n```text\n提取目标 Shared Rule Core\n→ 直接采用新 Schema 与 Map Profile / Scenario 结构\n→ 更新 JSON、校验、测试与行为基线\n→ 建立 RuntimeRuleset Loader\n→ 分模块接入 Card、Actor / Equipment、Map Profile 与 Scenario\n→ 建立 Initial GameState Factory\n```",
)

replace_once(
    "AGENTS.md",
    "## 5. Shared Rule Core 与配置接入\n\n当前 TypeScript Reference Implementation 是实际行为来源；Shared Rule Core 尚未实现，必须作为配置正式接入运行时的前置独立阶段，或配置接入 PR 的第一个阶段。\n\n统一顺序：\n\n```text\n0. 从当前 Reference Implementation 提取 Shared Rule Core\n1. 直接重构 Schema\n2. 拆分 Map Profile / Scenario 并更新 JSON\n3. 更新引用校验、结构测试和行为基线\n4. RuntimeRuleset Loader\n5. Card / Actor / Equipment / Map / Scenario 运行时接入\n6. Initial GameState Factory\n```",
    "## 5. Shared Rule Core 与配置接入\n\n当前 TypeScript Reference Implementation 是实际行为来源；Shared Rule Core 尚未实现，必须作为配置正式接入运行时的前置独立阶段，或配置接入 PR 的第一个阶段。\n\nProjectC `docs/runtime-data-integration-plan.md` 是正式阶段编号与完成标准的唯一来源。本文件只保留依赖摘要：\n\n```text\n提取目标 Shared Rule Core\n→ 新 Schema 与 Map Profile / Scenario 数据结构\n→ JSON、校验、测试与行为基线\n→ RuntimeRuleset Loader\n→ 分模块运行时接入\n→ Initial GameState Factory\n```",
)
replace_once(
    "AGENTS.md",
    "- 某类数据完成直接配置驱动后，删除对应 TypeScript 数据副本，并用 Factory、行为和确定性测试替代漂移测试。",
    "- 某类数据完成直接配置驱动后，删除对应 TypeScript 数据副本，并用 Factory、行为和确定性测试替代漂移测试；\n- 默认不改变现有规则结果；行为变化必须拆为独立 ruleset / Validation 修改；\n- 每一步保留回归测试，避免一次性重写全部运行时；\n- 固定 seed 与实验专用覆盖必须显式声明，不能成为隐性默认值；\n- 运行时接入阶段编号只在 ProjectC `runtime-data-integration-plan.md` 维护。",
)

replace_once(
    "config/README.md",
    "## 8. Shared Rule Core 与配置接入\n\n当前 TypeScript Reference Implementation 是实际行为来源；Shared Rule Core 尚未实现。\n\n统一顺序：\n\n```text\n0. 从当前 Reference Implementation 提取 Shared Rule Core\n1. 直接重构 core-rules.schema.json\n2. 拆分 Map Profile / Scenario\n3. 更新 core-rules.v0.json\n4. 更新引用校验、结构测试和现有行为基线\n5. 建立 RuntimeRuleset Loader\n6. 依次接入 Card Library、Actor / Equipment、Map Profile、Scenario\n7. 建立 Initial GameState Factory\n```\n\n当前 ruleset 没有外部正式依赖，不制作旧 Schema 迁移表、兼容加载器或长期 deprecated 字段层。",
    "## 8. Shared Rule Core 与配置接入\n\n当前 TypeScript Reference Implementation 是实际行为来源；Shared Rule Core 尚未实现。ProjectC `docs/runtime-data-integration-plan.md` 是正式阶段编号与完成标准的唯一来源；本文件只保留依赖摘要：\n\n```text\n提取目标 Shared Rule Core\n→ 直接采用新 Schema 与 Map Profile / Scenario 结构\n→ 更新 core-rules.v0.json、校验、测试与行为基线\n→ 建立 RuntimeRuleset Loader\n→ 分模块接入 Card、Actor / Equipment、Map Profile 与 Scenario\n→ 建立 Initial GameState Factory\n```\n\n当前 ruleset 没有外部正式依赖，不制作旧 Schema 迁移表、兼容加载器或长期 deprecated 字段层。\n\n### 配置接入要求\n\n- 默认不改变现有规则结果；若确需改变，拆分为独立玩法修改并更新 ruleset、Validation ID 和 Changelog；\n- 每一步保留并扩充回归测试，不允许先删除旧路径再补测试；\n- 避免一次性重写全部运行时，按可独立验收的阶段推进；\n- 允许实验专用覆盖、固定 seed 和 Fixture，但必须显式声明，不能成为隐性默认值；\n- 逻辑配置、Map Profile、Scenario 和规则算法不得依赖 Three.js、PixiJS、React 或 DOM；\n- 新增可调内容优先进入配置，但在目标 Shared Rule Core 完成前不得分别绑定到两套有差异的执行语义；\n- 某类数据完成直接接入后，删除对应 TypeScript 数据副本，并以 Factory、行为和确定性测试替代漂移测试。",
)

print("WebPrototype planning review fixes applied")
