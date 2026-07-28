# ProjectC Web Prototype

用于验证 ProjectC 核心规则、Hex6 空间、地图尺度、Travel / Tactical、环境信息流与网页表现的实验原型。

本仓库不是正式游戏工程，也不自动决定 ProjectC 正式规则。

---

## 1. 当前目标

当前原型用于验证：

- Square4 初始规则与 Hex6 空间对照；
- Hex6 邻接、Range、射线、击退、风和天气传播；
- World / Room 地图尺度；
- Travel / Tactical 共享 GameState；
- 2D / 3D 与规则状态解耦；
- 3 AP + 最多保留 1 AP；
- Actor 与 Cell 热交换；
- Ground / Sky 中的风、Cloud、Rain；
- 敌人公开 intent；
- 基础战斗、救援、返程和首批卡牌；
- DOM、PixiJS 与 Three.js 的表现和性能差异。

---

## 2. 规则权威

私有 `i-scan/ProjectC` 文档仓库负责：

- `docs/design.md`：产品方向和系统职责；
- `docs/core-rules-spec.md`：所有规则、机制和游戏内容的当前人类可读基准；
- `docs/core-rules-validation.md`：重要实验的问题、计划、证据和阶段结论；
- `docs/sync-status.md`：原型、规则和未来正式工程的差异。

当前分支中的代码和硬编码表示：

> 当前网页原型实现了什么。

它们不表示：

> ProjectC 已经正式接受了什么。

配置、Schema 和 ruleset Changelog 将由后续 `agent/rules-config-baseline` 分支引入。

---

## 3. 默认读取顺序

修改规则、机制、数值、Card、Actor、地图、环境或 Session 前，先阅读：

1. 本仓库 `AGENTS.md`；
2. ProjectC `docs/core-rules-spec.md`；
3. ProjectC `docs/core-rules-validation.md`；
4. 相关 ProjectC Changelog。

若无法访问 ProjectC 私有仓库，必须明确说明，不得只依据当前代码宣布规则已确认。

---

## 4. 当前页面和模块

当前原型包含：

- 早期 Square4 Rules Lab；
- Graphics Lab；
- Three.js / PixiJS Player View；
- Hex6 Tactical；
- Hex6 Travel；
- 2D / 3D 视图；
- World 与 R2～R7 Room；
- Mountain、BlocksSight 和 A*；
- intent、悔棋、重开、阶段推进、速度控制和状态导出。

Three.js 是当前主要可玩视觉验证方向；2D / PixiJS 保留为对照、总览和潜在低配置表现。正式引擎尚未决定。

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
npm run test
npm run build
```

---

## 7. 当前迁移边界

当前不为 Unity、Unreal、Godot 提前建立永久统一格式。

原型仍应保持：

- 稳定 ID；
- 规则、GameState 和表现分离；
- 相同输入和 seed 产生确定结果；
- 逻辑地图不依赖 Three.js、PixiJS 或 React；
- Hex6 拓扑、方向、距离和路径使用统一实现；
- 避免让 UI 条件分支成为唯一规则实现。

未来规则稳定、目标引擎明确后，再从已验证原型版本提取正式内容和迁移工具。

---

## 8. 历史规则文档

早期 Square4 10×10 规则说明将归档至：

```text
docs/archive/rules-square4-v0.md
```

归档文件只用于历史追溯和 A/B 回归，不作为活动规则来源。
