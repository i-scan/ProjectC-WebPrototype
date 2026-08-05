[![Deploy GitHub Pages](https://github.com/i-scan/ProjectC-WebPrototype/actions/workflows/deploy-pages.yml/badge.svg?branch=main&event=push)](https://github.com/i-scan/ProjectC-WebPrototype/actions/workflows/deploy-pages.yml)
# ProjectC Web Prototype

用于验证 ProjectC 核心规则、Hex6 空间、地图尺度、Travel / Tactical、环境信息流与网页表现的实验原型。

本仓库不是正式游戏工程，也不是 ProjectC 正式规则的唯一来源。

---

## 1. 当前目标

当前主要验证：

- Square4 历史规则与 Hex6 空间对照；
- Hex6 邻接、Range、射线、击退、风和天气传播；
- World / Room / 后续 Region 的尺度差异；
- Travel / Tactical 在同一 GameState 中的切换；
- 2D / 3D 与规则状态解耦；
- 3 AP + 最多保留 1 AP；
- Actor 与 Cell 热交换；
- Ground / Sky 中的风、Cloud、Rain；
- 敌人公开 intent；
- 基础战斗、救援、返程和首批卡牌；
- 提取目标 Shared Rule Core、推进配置驱动、确定性和未来迁移友好性；
- DOM、PixiJS 与 Three.js 的表现和性能差异。

---

## 2. 权威关系

### ProjectC 文档仓库

`i-scan/ProjectC` 负责：

- `docs/design.md`：产品方向、体验目标和系统职责；
- `docs/core-rules-spec.md`：所有规则、机制和游戏内容的当前人类可读基准；
- `docs/core-rules-validation.md`：重要实验的问题、计划、证据和阶段结论；
- `docs/runtime-data-integration-plan.md`：目标 Shared Rule Core 与配置接入顺序；
- `docs/ai-decisions.md`：重要取舍；
- `docs/task-log.md`：当前优先级；
- `docs/sync-status.md`：规则、ruleset 和未来正式工程差异。

### 本仓库

当前必须区分：

```text
config/core-rules.v0.json
= 当前实验的声明配置、目标值和内容数据权威

TypeScript Reference Implementation
= 当前实际执行的费用、目标、效果、时序、环境和 Objective 参考行为

GameState
= 当前运行过程中的可变状态权威

目标 Shared Rule Core
= 下一阶段需要从 Square4 / Hex6 重复逻辑中提取的统一算法层，当前尚未完成
```

其他职责：

- `config/core-rules.schema.json`：配置结构约束；
- `config/CHANGELOG.md`：每次影响玩法结果的机制、数值和地图变化；
- 测试：配置、拓扑和规则回归；
- 页面：体验和信息表达验证。

ruleset `0.1.0` 仍属于“配置镜像 + TypeScript 硬编码 + 漂移测试”。配置尚未被全部运行时直接消费，原型实现也不会自动成为正式规则。

---

## 3. 默认读取顺序

修改规则、机制、数值、Card、Actor、地图、环境、Objective 或 Session 前，先阅读：

1. 本仓库 `AGENTS.md`；
2. 本仓库 `config/README.md`；
3. ProjectC `docs/design.md` 当前快照与相关章节；
4. ProjectC `docs/core-rules-spec.md`；
5. ProjectC `docs/core-rules-validation.md` 中相关条目；
6. 与任务相关的 `config/CHANGELOG.md` 和 ProjectC Changelog。

配置接入、目标 Shared Rule Core、Map Profile、Scenario 或 Initial GameState Factory 任务还必须阅读 ProjectC `docs/runtime-data-integration-plan.md`。

不要只根据当前代码推断设计已经确认。

---

## 4. 当前页面和模块

当前原型包含：

- Square4 历史 Rules Lab；
- Hex6 规则与视觉原型；
- 2D / 3D Travel / Tactical；
- World 与可调 R2～R7 Room；
- Mountain、BlocksSight 和 A*；
- Graphics Lab；
- Debug / Regression View；
- Three.js / PixiJS Player View；
- intent、悔棋、重开、阶段推进、速度控制和状态导出。

Three.js 是当前主可玩视觉验证方向；PixiJS / 2D 保留为地图总览、对照和潜在低配置表现。正式引擎尚未决定。

---

## 5. 本地运行

需要 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run dev
```

---

## 6. 构建与测试

```bash
npm run validate:rules
npm run test
npm run build
```

`npm run test` 会先执行 Schema 和引用完整性校验，再运行 Vitest。

当前漂移测试只覆盖部分重复字段；尚未被直接配置驱动的 Card Effect、Environment、Equipment、Turn Phase 和 Scenario 等内容需要逐步补足覆盖。

---

## 7. 配置接入摘要

当前实际行为来源是 TypeScript Reference Implementation；Shared Rule Core 是尚未完成的目标层。ProjectC `docs/runtime-data-integration-plan.md` 是正式阶段编号与完成标准的唯一来源；本 README 只保留依赖摘要：

```text
提取目标 Shared Rule Core
→ 直接采用新 Schema 与 Map Profile / Scenario 结构
→ 更新 JSON、校验、测试与行为基线
→ 建立 RuntimeRuleset Loader
→ 分模块接入 Card、Actor / Equipment、Map Profile 与 Scenario
→ 建立 Initial GameState Factory
```

配置定义“是什么”，目标 Shared Rule Core 定义“如何执行”，GameState 保存“现在变成了什么”。

### Map Profile

负责 topology、尺寸、边界、Void、形状、Region 拼接和山脊、通口、障碍密度等几何生成参数和约束。

不负责具体 Actor、Objective、Resource、Shelter 实例或初始天气；这些属于 Scenario。

### Scenario

负责 Actor 实例与位置、Shelter、Objective、Resource、初始 Cell / Sky / Weather、任务、seed 和测试标签。

当前 ruleset 没有外部正式依赖；开始接入时直接使用新 Schema 和新 JSON 结构，不制作旧格式迁移表或兼容层。

纯接入重构且玩法行为不变时不提升 rulesetVersion；Schema 结构变化时独立提升 schemaVersion。

---

## 8. 配置更新工作流

### 新验证问题

当修改改变“正在验证什么”时：

1. 对照 ProjectC `design.md` 的体验目标和系统职责；
2. 在 `core-rules-validation.md` 建立或更新验证条目；
3. 再修改本仓库配置、代码、测试和场景；
4. 更新 `config/CHANGELOG.md`；
5. 完成自动测试和试玩；
6. 将阶段结论回写 ProjectC。

### 已登记实验中的调参

同一验证问题内的小幅调参可以直接在本仓库发起，但必须：

- 修改配置；
- 提升合适的 ruleset 版本；
- 更新 Changelog；
- 更新测试；
- 标记保留、继续实验或回滚。

---

## 9. 历史规则文档

早期 Square4 10×10 规则快照位于：

```text
docs/archive/rules-square4-v0.md
```

归档文件只用于历史追溯和 A/B 回归，不作为活动规则来源。

---

## 10. 当前不做正式跨引擎 spec

当前不会为了 Unity、Unreal 或 Godot 提前建立永久统一数据格式。

本仓库只保持最低迁移友好性：

- 稳定 ID；
- 配置、规则算法、GameState 和表现分离；
- 相同输入和 seed 产生确定结果；
- schemaVersion / rulesetVersion；
- 关卡逻辑与 Three.js、PixiJS、React 解耦；
- 拓扑、方向、距离和路径使用统一实现；
- 避免把机制长期散落在 UI 特殊分支中。

正式引擎和规则结构稳定后，再从已验证 ruleset、行为测试和 Scenario Fixture 提取正式内容包和导入方式。
