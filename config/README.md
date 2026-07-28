# WebPrototype 规则配置

本目录保存 `ProjectC-WebPrototype` 当前可执行实验 ruleset。

---

## 1. 文件职责

- `core-rules.v0.json`：当前网页实验的机器可读配置；
- `core-rules.schema.json`：JSON Schema 2020-12 字段约束；
- `CHANGELOG.md`：每次影响玩法结果的配置变更，最新在前。

历史 Square4 10×10 规则说明位于 `docs/archive/`，不再作为当前规则来源。

---

## 2. 与 ProjectC 文档的关系

私有设计仓库 `i-scan/ProjectC` 负责：

- `docs/design.md`：设计总纲、体验目标和系统职责；
- `docs/core-rules-spec.md`：规则、机制和游戏内容的当前人类可读基准；
- `docs/core-rules-validation.md`：重要实验的问题、候选、计划、证据和阶段判断；
- `docs/sync-status.md`：ruleset、规则基准和未来正式工程的差异。

本目录回答：

> 当前网页实验精确运行什么？

ProjectC `core-rules-spec.md` 回答：

> 当前如何判断这项规则，它是 validated、candidate、prototype-snapshot、pending 还是 deprecated？

`design.md` 回答：

> 为什么需要这项系统，它应服务怎样的玩家体验？

三者不是重复权威。

---

## 3. 权威边界

- 本目录对网页原型当前运行值负责；
- ProjectC 不保存与之竞争的实验配置副本；
- 本目录中的值不会自动成为正式规则；
- WebPrototype 可以为对照实验偏离 ProjectC 当前候选，但必须记录原因、版本和 validation ID；
- 规则通过验证并经用户接受后，才在 ProjectC `core-rules-spec.md` 晋升；
- 当前 JSON 不是未来 Unity、UE 或 Godot 的永久正式格式。

顶层 `status` 使用 ProjectC 统一状态词：

- `validated`；
- `candidate`；
- `prototype-snapshot`；
- `pending`；
- `deprecated`。

当前 ruleset 使用 `prototype-snapshot`，表示它精确描述网页实验，但不表示全部内容已经接受。

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
- Ruleset Minor：新增 Card、Actor、环境规则、地图 profile 或兼容字段；
- Ruleset Major：AP、牌堆、拓扑、Session、时序或内容结构出现不兼容变化；
- Schema 版本独立提升，纯元数据或字段结构变化不强制改变 rulesetVersion。

只修改 README、注释、测试描述或权威引用而不改变玩法时，不提升 rulesetVersion，但应更新 Schema 版本或 PR 说明。

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
- Room / World / Region profile；
- Void、Mountain、障碍、路径、视线和旅行参数；
- Objective、Session 和 Shelter；
- 实验回滚与废弃。

仅视觉、重构或性能变化，如果不改变规则结果，应记录在 PR 或 ProjectC 阶段 Changelog，而不是伪造 ruleset 变化。

---

## 7. 当前接入状态

ruleset `0.1.0` 当前属于：

> 配置镜像 + 引用校验 + 硬编码漂移测试。

自动检查覆盖：

- 配置 Card 与 `CARD_LIBRARY`；
- AP、温度和初始牌序与初始 GameState；
- Actor 初始值；
- Room 半径；
- World 尺寸、起点、目标和警戒距离；
- Card、Equipment、mode 和其他 ID 引用。

当前运行时仍保留重复硬编码。回归测试负责防止静默分叉。

---

## 8. 下一阶段配置驱动

优先顺序：

```text
config
→ Card Library
→ Actor / Equipment Template
→ Scenario / Map Profile
→ Initial GameState
```

迁移时要求：

- 不改变现有规则结果；
- 为每一步保留回归测试；
- 避免一次性重写全部运行时；
- 仍允许实验专用覆盖和固定 seed；
- 逻辑配置不依赖 Three.js、PixiJS 或 React。

---

## 9. 当前迁移友好性边界

当前只要求：

- 稳定 ID；
- 配置、规则、GameState 与表现分离；
- schemaVersion / rulesetVersion；
- 确定性输入和输出；
- 逻辑关卡和渲染器解耦；
- 共用 Hex6 拓扑、方向、距离和路径；
- 避免长期按 Card ID 编写 UI 特例。

不要求当前 JSON 直接兼容 Unity ScriptableObject、UE DataAsset 或 Godot Resource。正式迁移格式需要在目标引擎明确后验证。
