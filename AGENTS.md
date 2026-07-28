# ProjectC WebPrototype Agent Rules

本仓库是 ProjectC 的可执行规则、Hex6、地图、Travel / Tactical 和视觉实验环境，不是正式游戏工程。

---

## 必须读取

涉及规则、机制、数值、Card、Actor、Equipment、Cell、环境、地图或 Session 前，先阅读：

1. 本仓库 `README.md`；
2. 本仓库 `AGENTS.md`；
3. ProjectC `docs/core-rules-spec.md`；
4. ProjectC `docs/core-rules-validation.md`；
5. 相关 ProjectC Changelog。

若无法访问 ProjectC 私有仓库，必须说明，不得仅凭当前代码宣布设计已经确认。

---

## 权威边界

- ProjectC `core-rules-spec.md`：规则、机制和游戏内容的人类可读基准；
- ProjectC `core-rules-validation.md`：实验问题、方案和证据；
- 本分支代码：当前网页参考实现；
- 后续配置分支 `agent/rules-config-baseline`：当前实验精确值、Schema 和 Changelog。

代码存在不等于规则 validated。

---

## 修改规则

改变“正在验证什么”时，先更新 ProjectC validation，再实现。

同一验证问题内的小幅调参可以在原型中完成，但配置分支建立后，应优先修改配置、版本和 Changelog，而不是继续扩散硬编码。

---

## 实现约束

- 规则层是 GameState 权威；
- Three.js、PixiJS 和 React 只消费状态和规则事件；
- Travel / Tactical 共享状态；
- 2D / 3D 切换不改变逻辑；
- 当前默认验证拓扑为 Hex6 candidate；
- Ground / Sky 平面坐标一一对应；
- Range、路径、击退、风向和世界方向共用统一 Hex6 定义；
- intent 路径和实际移动应使用同一寻路结果；
- Mountain 当前只确认 Ground 战术阻挡，不自动扩展天气规则；
- 相同初始状态、Action 序列和 seed 应产生相同结果；
- 逻辑关卡不得依赖具体渲染器。

---

## 迁移边界

当前不建立同时兼容 Unity、Unreal、Godot 的正式数据格式。

只保持稳定 ID、规则与表现分离、确定性和逻辑场景解耦。正式迁移在规则稳定和目标引擎明确后单独验证。

---

## 历史文档

`docs/archive/` 只保存历史快照，不作为活动规则来源。

发现旧文档与 ProjectC 规则基准或当前原型冲突时，应归档、标记 deprecated，并更新引用。
