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

三份 ProjectC 文档职责不同，不能互相替代：

- `design.md`：判断实验是否服务整体体验、循环和系统职责；
- `core-rules-spec.md`：确认规则状态与执行边界；
- `core-rules-validation.md`：确认实验问题、控制变量和证据。

窄范围调参不必阅读全文，但必须读取设计快照和相关章节。

若无法访问 ProjectC 私有仓库，必须明确说明，不得仅依据当前代码宣布规则已经确认。

---

## 3. 权威边界

- `config/core-rules.v0.json`：当前网页实验精确值；
- `config/core-rules.schema.json`：配置结构；
- `config/CHANGELOG.md`：每次影响玩法结果的变化；
- ProjectC `docs/design.md`：设计意图和系统职责；
- ProjectC `docs/core-rules-spec.md`：规则、机制和内容的当前人类可读基准及状态；
- ProjectC `docs/core-rules-validation.md`：实验问题、计划和证据。

当前配置可以偏离规则基准以完成实验，但必须记录版本、目的、validation ID 和验证状态。

代码存在不等于规则 `validated`。配置中的精确值属于 `prototype-snapshot`，除非 ProjectC 明确完成晋升。

---

## 4. 新需求如何发起

### 改变验证问题

例如：

- 更换 Square4 / Hex6；
- 更改回合或时间模型；
- 引入新的体温资源；
- 改变 Travel / Tactical 关系；
- 改变 Card、Actor、Cell 或 Session 基础结构。

必须先更新 ProjectC `core-rules-validation.md`，再实现。

### 同一实验内调参

例如：

- Range 3 → 2；
- Room R4 → R5；
- 警戒距离 3 → 2；
- 热交换阈值 2 → 1。

可以直接修改本仓库，但必须：

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

## 5. 配置和实现原则

- 配置是实验值权威，不在多个 TypeScript 文件长期重复维护同一内容；
- 当前允许“配置镜像 + 漂移检测”过渡，但新增内容优先走配置；
- 逐步让配置直接生成 Card Library、Actor / Equipment Template、Scenario 和初始 GameState；
- 稳定 ID 不依赖中文名称、数组下标或画面对象引用；
- 规则层输出 GameState 和 Event，表现层只消费结果；
- Three.js、PixiJS 和 React 不得各自实现一份 Hex Range、路径、风向或规则判定；
- 相同初始状态、Action 序列和 seed 应得到相同结果；
- 逻辑地图和 Scenario 不依赖具体渲染器；
- 避免按 Card ID 在 UI 中长期堆叠特殊逻辑。

---

## 6. 地图与表现不变量

- 当前默认规则拓扑为 Hex6 `candidate`；
- Ground 与 Sky 平面坐标一一对应；
- Travel / Tactical 共享 GameState；
- 2D / 3D 切换不改变规则结果；
- World / Room 是实验 profile，不自动代表最终产品模式；
- Mountain 当前只确认 Ground 战术阻挡，不能自动扩展为天气阻挡；
- Renderer 不得修改规则状态；
- intent 路径和实际移动应使用同一寻路结果。

---

## 7. 当前迁移边界

当前不建立同时兼容 Unity、Unreal、Godot 的正式数据包。

可以为当前原型改善：

- 稳定 ID；
- schemaVersion / rulesetVersion；
- 配置引用完整性；
- 确定性测试；
- 拓扑和方向共用；
- 逻辑场景数据；
- 规则与表现解耦。

不要为了假设中的未来引擎限制当前机制实验，除非用户明确要求进行迁移验证。

---

## 8. 过时文档

`docs/archive/` 只保存历史快照，不作为活动规则来源。

发现旧文档与配置或 ProjectC 基准冲突时：

- 不要静默继续使用；
- 标记归档或 `deprecated`；
- 更新 README / AGENTS 的引用；
- 必要时在 ProjectC `sync-status.md` 记录差异。

---

## 9. 完成任务后的回复

说明：

- 修改文件；
- rulesetVersion / schemaVersion 是否变化；
- 玩法行为是否变化；
- 自动测试和构建结果；
- 对应 validation ID；
- 哪些内容仍是 `prototype-snapshot`；
- 是否需要同步 ProjectC 文档。
