# WebPrototype 规则配置

本目录保存 `ProjectC-WebPrototype` 当前实验的声明配置、目标值和内容数据。

---

## 1. 文件职责

- `core-rules.v0.json`：当前网页实验的机器可读声明配置；
- `core-rules.schema.json`：JSON Schema 2020-12 字段约束；
- `experiments/val-012-momentum-lab.v3.json`：当前 Momentum、动作链、制动与最小碰撞实验；
- `experiments/val-012-action-chain.v2.json`：上一版 UT2 分段动作与动量链快照；
- `experiments/val-012-unified-at-timeline.v1.json`：上一轮统一 AT 时间实验，保留为 UT1 历史对照；
- `CHANGELOG.md`：每次影响玩法结果的配置变更，最新在前。

历史 Square4 10×10 规则说明位于 `docs/archive/`，不再作为当前规则来源。

---

## 2. 与 ProjectC 文档的关系

私有设计仓库 `i-scan/ProjectC` 负责：

- `docs/design.md`：设计总纲、体验目标和系统职责；
- `docs/core-rules-spec.md`：规则、机制和游戏内容的当前人类可读基准；
- `docs/core-rules-validation.md`：重要实验的问题、候选、计划、证据和阶段判断；
- `docs/runtime-data-integration-plan.md`：目标 Shared Rule Core 与配置接入计划；
- `docs/sync-status.md`：ruleset、规则基准和未来正式工程的差异。

本目录回答：

> 当前实验希望使用哪些精确数据与参数？

ProjectC `core-rules-spec.md` 回答：

> 当前如何判断这项规则，它是 validated、candidate、prototype-snapshot、pending 还是 deprecated？

`design.md` 回答：

> 为什么需要这项系统，它应服务怎样的玩家体验？

三者不是重复权威。

---

## 3. 当前运行权威

当前必须区分：

```text
本目录
= 声明配置、目标值和内容数据权威

TypeScript Reference Implementation
= 当前实际执行的规则算法与参考行为

GameState
= 当前运行过程中的可变状态权威

目标 Shared Rule Core
= 下一阶段需要从 Square4 / Hex6 重复逻辑中提取的统一算法层，当前尚未完成
```

ruleset `0.1.0` 尚未被全部运行模块直接消费，因此本目录暂时不能被描述为完整运行时的唯一来源。

`#rules-lab` 与 `#hex-prototype` 当前运行独立实验 ruleset `VAL-012-UT3`。它以 `val-012-momentum-lab.v3.json`、`src/hex/unifiedTimeline.ts` 与 `src/hex/actionChain.ts` 为直接权威，不回写或覆盖 Square4 / 全局 `0.1.0` 历史快照。

UT3 保留 `Intro → Core AT Phase[] → Outro`，并区分 Active / Pending Momentum。世界事件只在 Phase 边界处理；Chain Window 不推进世界时间。当前实现 Drive / Rush Strike / Contextual Brake、M0–M3 Impact、Stability / Intercept、离散转向损耗、Hard / Reflect 与一次 Secondary Impact。完整动作库、连续物理反射、质量体系与正式平衡仍不在本轮结论内。

当前值不会自动成为正式规则。WebPrototype 可以为对照实验偏离 ProjectC 当前候选，但必须记录原因、版本和 validation ID。

顶层 `status` 使用 ProjectC 统一状态词：

- `validated`；
- `candidate`；
- `prototype-snapshot`；
- `pending`；
- `deprecated`。

当前 UT3 ruleset 使用 `candidate`，表示 Momentum 语法、动作链与最小碰撞仍在验证；其中诊断场景、AT 数值、Actor 时序和内容配置仍只属于 `prototype-snapshot`，不表示已经接受为正式规则。

Map profile 内部的 `implemented` 只描述该 profile 已在网页原型实现，不代表产品规则已验证。

---

## 4. 版本与追溯

配置包含：

- `schemaVersion`：字段结构版本；
- `rulesetVersion`：玩法、内容和数值版本；
- `implementationCommit`：该配置当前镜像的参考实现提交；
- Design Bible、规则基准和验证记录引用。

建议：

- Ruleset Patch：数值微调或不改变消费方式的行为修正；
- Ruleset Minor：新增 Card、Actor、环境规则、Map Profile、Scenario 或兼容字段；
- Ruleset Major：AP、牌堆、拓扑、Session、时序或内容结构出现不兼容变化；
- Schema 版本独立提升，纯元数据或字段结构变化不强制改变 rulesetVersion。

只修改文档、测试描述、权威引用或进行不改变行为的目标 Shared Rule Core / 配置接入重构时，不提升 rulesetVersion。

---

## 5. 发起实验

### 新验证问题

当修改改变“正在验证什么”时：

1. 阅读 ProjectC `design.md` 当前快照和相关系统章节；
2. 在 `core-rules-validation.md` 建立或更新 VAL 条目；
3. 明确候选、控制变量、场景和验收指标；
4. 再修改本目录、代码、测试和场景。

### 已登记实验中的调参

同一 VAL 条目内的小幅调整可以直接从本目录发起。

每次影响玩法结果的更新必须：

1. 修改 `core-rules.v0.json`；
2. 必要时修改 Schema；
3. 提升合适的 rulesetVersion；
4. 在 `CHANGELOG.md` 记录旧值、新值、原因、预期和验证状态；
5. 更新测试；
6. 运行 `npm run validate:rules`；
7. 运行 `npm test`；
8. 运行 `npm run build`；
9. 标记保留、继续实验或回滚；
10. 阶段结束后回写 ProjectC validation。

---

## 6. Changelog 记录范围

以下变化必须记录：

- Card 费用、Range、目标和效果；
- AP、保留 AP、牌堆、抽牌和洗牌；
- Actor、Equipment、Enemy 和 NPC 数值；
- 温度、湿度、风、Cloud、Rain 和物态阈值；
- 回合、局部反应、全局环境和热交换顺序；
- Map Profile 的拓扑、尺寸、边界、形状和几何生成参数；
- Scenario 的 Actor、Objective、Resource、Shelter、初始天气和任务；
- Void、Mountain、障碍、路径、视线和旅行参数；
- Session 规则；
- 实验回滚与废弃。

仅视觉、重构或性能变化，如果不改变规则结果，应记录在 PR 或 ProjectC 阶段 Changelog，而不是伪造 ruleset 变化。

---

## 7. 当前接入状态

ruleset `0.1.0` 当前属于：

> 配置镜像 + 引用校验 + 部分硬编码漂移测试。

已经检查：

- Card ID、名称、费用、Range、目标与 Layer；
- AP、温度和初始牌序；
- Actor 部分初始值；
- Room 半径；
- World 尺寸、起点、目标和警戒距离；
- Card、Equipment、mode 和其他 ID 引用。

尚未完整覆盖：

- Card Effect 具体参数；
- Environment 阈值和时序；
- Equipment 全部字段；
- Turn Phase；
- Map Profile 几何生成；
- Scenario；
- Initial GameState。

当前运行时仍保留重复硬编码，回归测试只能防止部分静默分叉。

---

## 8. Shared Rule Core 与配置接入

当前 TypeScript Reference Implementation 是实际行为来源；Shared Rule Core 尚未实现。ProjectC `docs/runtime-data-integration-plan.md` 是正式阶段编号与完成标准的唯一来源；本文件只保留依赖摘要：

```text
提取目标 Shared Rule Core
→ 直接采用新 Schema 与 Map Profile / Scenario 结构
→ 更新 core-rules.v0.json、校验、测试与行为基线
→ 建立 RuntimeRuleset Loader
→ 分模块接入 Card、Actor / Equipment、Map Profile 与 Scenario
→ 建立 Initial GameState Factory
```

当前 ruleset 没有外部正式依赖，不制作旧 Schema 迁移表、兼容加载器或长期 deprecated 字段层。

### 配置接入要求

- 默认不改变现有规则结果；若确需改变，拆分为独立玩法修改并更新 ruleset、Validation ID 和 Changelog；
- 每一步保留并扩充回归测试，不允许先删除旧路径再补测试；
- 避免一次性重写全部运行时，按可独立验收的阶段推进；
- 允许实验专用覆盖、固定 seed 和 Fixture，但必须显式声明，不能成为隐性默认值；
- 逻辑配置、Map Profile、Scenario 和规则算法不得依赖 Three.js、PixiJS、React 或 DOM；
- 新增可调内容优先进入配置，但在目标 Shared Rule Core 完成前不得分别绑定到两套有差异的执行语义；
- 某类数据完成直接接入后，删除对应 TypeScript 数据副本，并以 Factory、行为和确定性测试替代漂移测试。

### Map Profile

负责：

- topology；
- 尺寸、半径或宽高；
- 有效边界和 Void；
- 形状；
- Region 拼接；
- 山脊、通口、障碍密度等几何生成参数与约束。

不包含具体 Actor、Objective、Resource、Shelter 实例或初始天气。

### Scenario

负责：

- 使用的 Map Profile；
- seed；
- Actor 实例与位置；
- Shelter、Objective、Resource 和兴趣点；
- 初始 Cell、Ground、Sky、Weather 和 Intent；
- 任务、测试标签和观察指标。

### Initial GameState

由 RuntimeRuleset + Map Profile + Scenario + seed 构建，不直接把运行中的完整 GameState 保存为配置。

某类数据完成直接配置驱动后，应删除对应 TypeScript 数据副本，并用 Factory、行为和确定性测试替代漂移测试。

---

## 9. 当前迁移友好性边界

当前只要求：

- 稳定 ID；
- 配置、规则算法、GameState 与表现分离；
- schemaVersion / rulesetVersion；
- 确定性输入和输出；
- 逻辑关卡和渲染器解耦；
- 共用 Hex6 拓扑、方向、距离和路径；
- 避免长期按 Card ID 编写 UI 特例。

不要求当前 JSON 直接兼容 Unity ScriptableObject、UE DataAsset 或 Godot Resource。正式迁移格式需要在目标引擎明确后验证。
