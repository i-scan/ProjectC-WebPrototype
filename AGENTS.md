# ProjectC WebPrototype Agent Rules

本文件约束在本仓库中工作的 AI Agent。

---

## 1. 仓库定位

本仓库是 ProjectC 的：

- 可执行规则实验；
- Hex6、地图、Travel / Tactical 验证环境；
- 视觉和信息流实验；
- 当前规则参考实现；
- 配置驱动与回归测试环境。

它不是正式游戏工程，也不自动决定 ProjectC 正式设计。

---

## 2. 必须读取

任何涉及规则、机制、数值、Card、Actor、Equipment、Cell、环境、地图、Objective、Session 或 Shelter 的任务，先阅读：

1. 本仓库 `README.md`；
2. 本仓库 `AGENTS.md`；
3. 本仓库 `config/README.md`；
4. ProjectC `docs/design.md` 的当前设计快照与相关系统章节；
5. ProjectC `docs/core-rules-spec.md`；
6. ProjectC `docs/core-rules-validation.md` 中相关 VAL 条目；
7. 相关 `config/CHANGELOG.md` 和 ProjectC Changelog。

涉及 Shared Rule Core、配置接入、Map Profile、Scenario 或 Initial GameState Factory 时，还必须阅读 ProjectC `docs/runtime-data-integration-plan.md`。

三份 ProjectC 核心文档职责不同：

- `design.md`：判断实验是否服务整体体验、循环和系统职责；
- `core-rules-spec.md`：确认规则状态与执行边界；
- `core-rules-validation.md`：确认实验问题、控制变量和证据。

若无法访问 ProjectC 私有仓库，必须明确说明，不得仅依据当前代码宣布规则已经确认。

---

## 3. 权威边界

当前必须区分：

```text
config/core-rules.v0.json
= 当前实验的声明配置、目标值和内容数据权威

TypeScript Shared Rule Core
= 当前实际执行的费用、目标、效果、时序、环境与 Objective 算法语义

GameState
= 当前运行过程中的可变状态权威
```

其他文档：

- `config/core-rules.schema.json`：配置结构；
- `config/CHANGELOG.md`：每次影响玩法结果的变化；
- ProjectC `design.md`：设计意图和系统职责；
- ProjectC `core-rules-spec.md`：规则、机制和内容基准及状态；
- ProjectC `core-rules-validation.md`：实验问题、计划和证据。

ruleset `0.1.0` 仍是“配置镜像 + TypeScript 硬编码 + 漂移测试”，配置尚未被全部运行时直接消费。代码存在不等于规则 `validated`。

---

## 4. 新需求如何发起

### 改变验证问题

例如更换拓扑、时间模型、体温结构、Travel / Tactical 关系，或改变 Card、Actor、Cell、Session 基础结构时，必须先更新 ProjectC validation，再实现。

### 同一实验内调参

Range、Room 半径、警戒距离、热交换阈值等同一 VAL 内的小幅调整可以直接修改本仓库，但必须：

1. 修改配置；
2. 必要时修改 Schema；
3. 提升合适的 rulesetVersion；
4. 更新 `config/CHANGELOG.md`；
5. 更新测试；
6. 运行 `npm run validate:rules`、`npm test`、`npm run build`；
7. 标记保留、继续实验或回滚；
8. 阶段结束后回写 ProjectC validation。

仅视觉、重构或性能变化且不改变规则结果时，不提升 rulesetVersion，但 PR 必须说明无玩法变化。

---

## 5. Shared Rule Core 与配置接入

Shared Rule Core 不是后置优化，而是配置接入的前置技术整理，或配置接入 PR 的第一个独立阶段。

统一顺序：

```text
0. Shared Rule Core
1. RuntimeRuleset Loader
2. Card Library
3. Actor / Equipment Template
4. Map Profile
5. Scenario Definition
6. Initial GameState Factory
```

### Shared Rule Core

Square4 / Hex6 应共用：

- AP、支付、失败与退款；
- Damage、Shield、死亡与失能；
- Card 目标和 Effect Handler；
- 温度与局部环境反应；
- 阶段和 Objective 更新。

空间差异只通过 Topology Adapter 提供邻接、距离、直线、路径和方向。

### RuntimeRuleset

业务模块通过统一 Loader 获取校验和 normalize 后的 RuntimeRuleset，不在组件中散落读取原始 JSON。

### Map Profile

Map Profile 保存：

- topology；
- 尺寸、半径或宽高；
- 有效边界和 Void；
- 形状；
- Region 拼接；
- 山脊、通口、障碍密度等几何生成参数与约束。

Map Profile 不保存具体 Actor、Objective、Resource、Shelter 实例或初始天气；这些属于 Scenario。

### Scenario

Scenario 保存 Actor 实例与位置、Shelter、Objective、Resource、初始 Cell / Sky / Weather、任务、seed 和测试标签。

配置定义“是什么”，Shared Rule Core 定义“如何执行”，GameState 保存“现在变成了什么”。

---

## 6. 实现原则

- 新增可调内容优先进入配置，但不得绕过 Shared Rule Core；
- 稳定 ID 不依赖中文名称、数组下标或画面对象引用；
- 规则层输出 GameState 和 Event，表现层只消费结果；
- Three.js、PixiJS 和 React 不得各自实现一份 Range、路径、风向或规则判定；
- 相同 ruleset、Scenario、Action 序列和 seed 应得到相同结果；
- 逻辑地图和 Scenario 不依赖具体渲染器；
- 避免按 Card ID 在 UI 中长期堆叠特殊逻辑；
- 某类数据完成直接配置驱动后，删除对应 TypeScript 数据副本，并用 Factory、行为和确定性测试替代漂移测试。

---

## 7. 地图与表现不变量

- 当前默认规则拓扑为 Hex6 `candidate`；
- Ground 与 Sky 平面坐标一一对应；
- Travel / Tactical 共享 GameState；
- 2D / 3D 切换不改变规则结果；
- World / Room 是实验 profile，不自动代表最终产品模式；
- Mountain 当前只确认 Ground 战术阻挡，不能自动扩展为天气阻挡；
- Renderer 不得修改规则状态；
- intent 路径和实际移动应使用同一寻路结果。

---

## 8. 当前迁移边界

当前不建立同时兼容 Unity、Unreal、Godot 的正式数据包。

只改善：

- 稳定 ID；
- schemaVersion / rulesetVersion；
- 配置引用完整性；
- 确定性测试；
- 拓扑和方向共用；
- 逻辑场景数据；
- 规则与表现解耦。

不要为了假设中的未来引擎限制当前机制实验。

---

## 9. 过时文档

`docs/archive/` 只保存历史快照，不作为活动规则来源。

发现旧文档与配置或 ProjectC 基准冲突时，不得静默继续使用；应归档或标记 `deprecated`，并更新引用与同步状态。

---

## 10. 完成任务后的回复

说明：

- 修改文件；
- rulesetVersion / schemaVersion 是否变化；
- 玩法行为是否变化；
- 自动测试和构建结果；
- 对应 validation ID；
- 哪些内容仍是 `prototype-snapshot`；
- 当前接入阶段；
- 是否需要同步 ProjectC 文档。
