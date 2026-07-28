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
- 配置驱动、确定性和未来迁移友好性；
- DOM、PixiJS 与 Three.js 的表现和性能差异。

---

## 2. 权威关系

### ProjectC 文档仓库

`i-scan/ProjectC` 负责：

- `docs/design.md`：产品方向、体验目标和系统职责；
- `docs/core-rules-spec.md`：所有规则、机制和游戏内容的当前人类可读基准；
- `docs/core-rules-validation.md`：重要实验的问题、计划、证据和阶段结论；
- `docs/ai-decisions.md`：重要取舍；
- `docs/task-log.md`：当前优先级；
- `docs/sync-status.md`：规则、ruleset 和未来正式工程差异。

### 本仓库

本仓库负责：

- `config/core-rules.v0.json`：当前网页实验 ruleset 的精确配置；
- `config/core-rules.schema.json`：配置结构约束；
- `config/CHANGELOG.md`：每次影响玩法结果的机制、数值和地图变化；
- 代码：当前规则的参考实现；
- 测试：配置、拓扑和规则回归；
- 页面：体验和信息表达验证。

必须区分：

```text
ProjectC/design.md
= 游戏为何如此设计、应提供怎样的体验

ProjectC/core-rules-spec.md
= ProjectC 当前如何判断一项规则及其状态

WebPrototype/config
= 当前网页版本精确运行什么
```

WebPrototype 可以为了实验暂时偏离规则基准，但必须记录目的、版本、validation ID 和验证状态。原型实现不会自动成为正式规则。

---

## 3. 默认读取顺序

修改规则、机制、数值、Card、Actor、地图、环境、Objective 或 Session 前，先阅读：

1. 本仓库 `AGENTS.md`；
2. 本仓库 `config/README.md`；
3. ProjectC `docs/design.md` 当前快照与相关章节；
4. ProjectC `docs/core-rules-spec.md`；
5. ProjectC `docs/core-rules-validation.md` 中相关条目；
6. 与任务相关的 `config/CHANGELOG.md` 和 ProjectC Changelog。

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

当前 ruleset `0.1.0`、schema `0.2.0` 仍属于“配置镜像 + 硬编码漂移检测”的过渡阶段。后续优先让配置直接构建 Card Library、Actor / Equipment Template、Scenario 和初始 GameState。

---

## 7. 配置更新工作流

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

## 8. 历史规则文档

早期 Square4 10×10 规则快照位于：

```text
docs/archive/rules-square4-v0.md
```

归档文件只用于历史追溯和 A/B 回归，不作为活动规则来源。

---

## 9. 当前不做正式跨引擎 spec

当前不会为了 Unity、Unreal 或 Godot 提前建立永久统一数据格式。

本仓库只保持最低迁移友好性：

- 稳定 ID；
- 配置、规则、GameState 和表现分离；
- 相同输入和 seed 产生确定结果；
- schemaVersion / rulesetVersion；
- 关卡逻辑与 Three.js、PixiJS、React 解耦；
- 拓扑、方向、距离和路径使用统一实现；
- 避免把机制长期散落在 UI 特殊分支中。

正式引擎和规则结构稳定后，再从已验证 ruleset 提取正式内容包和导入方式。
