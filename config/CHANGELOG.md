# Core Rules Config Changelog

本文件记录 WebPrototype 中每一次影响玩法结果的机制、数值、地图和时序变化，最新记录在前。

每次记录至少包含：

- ruleset / schema 版本与日期；
- 对应 validation ID；
- 修改字段；
- 旧值与新值；
- 修改原因与预期影响；
- 验证状态和结果；
- 对应提交或 PR。

---

## Experiment Ruleset `VAL-012-UT3` — 2026-08-08

### 类型

VAL-012 Momentum 的 Carry / Impact / Stability / Steering 与最小碰撞实验；**候选实验行为，不构成正式规则晋升**。

### 设计与程序来源

- `i-scan/ProjectC:docs/VAL-012-thermal-clock-action-time-prototype-plan.md` revision 4；
- `i-scan/ProjectC:docs/VAL-012-unified-time-system-program-handoff.md` UT3；
- 页面入口：`#rules-lab`（诊断场景）与 `#hex-prototype`（整合原型）；
- 实现标识：`momentum-collision-lab-v1`；
- 上一实验：`VAL-012-UT2 / action-chain-phase-v1`。

### 规则变化

- 正式区分仅在动作 Core 中存在的 `Active Momentum` 与 Outro 后供下一动作读取的 `Pending Momentum`；
- Carry 只在同轴 Rush Strike 中跳过 Start，不提供线性 AT 折扣或通用额外位移；
- Rush Strike 最多沿所选轴推进两格并命中路径上首个 Actor；M0 / M1 / M2 / M3 分别映射 Normal / Push / Launch / Pierce；
- 转向承诺为 `0°: 0`、`±60°: -1`、`±120°: -2`；180° 必须先执行 `Brake · 1 AT`，并清空 Momentum 与 Axis；
- Normal Hit 造成伤害并使 Momentum -1；Intercept 使 Momentum -2，归零时中断轨迹与 Chain；
- 加入 Hard Wall、Reflect Left / Right、Crash / Bounce 与至多一次 Secondary Impact 的离散 Forced Motion；
- 预览与执行共用 `src/hex/actionChain.ts`，不在 React 或渲染器中复制玩法判断。
- 诊断 Dummy 首次 Ready 设为 4 AT，晚于 T1 的 `Drive 2 AT + Carry Rush 1 AT`，使 Launch / Pierce 结果先形成可观察的稳定落点；其后仍进入同一全局队列。

### 页面与操作变化

- 原 Square4 规则实验室入口改造成 T1–T11 Momentum 实验场景，提供 M0–M3、Normal Hit、Intercept、Brake 与表面碰撞的可复位诊断；
- Hex6 的 Drive / Rush Strike 不再通过卡牌内部方向或目标按钮执行；改为“选择行动卡 → 棋盘高亮合法落点/Actor → 点击棋盘提交”；
- Drive Outro 后自动聚焦 Rush Strike 并在棋盘显示可 Carry 的目标；
- 规则表现加入分级轨迹、Push 低滑移、Launch 高弧、Pierce 快速穿越、Bounce 折向、Chain 动态冻结和 Brake 状态反馈。

### 验证状态

- [x] UT3 独立声明配置、规则校验与稳定 ruleset / implementation ID；
- [x] Carry、Impact、Stability、Steering、Brake、Hard / Reflect 行为测试；
- [x] 规则实验场景与 Hex6 使用共享规则核心；
- [ ] production build、真实浏览器交互与 Pages commit 回读（本提交合并后更新）。

对应 Validation：`VAL-012`。

---

## Experiment Ruleset `VAL-012-UT2` — 2026-08-08

### 类型

VAL-012 分段动作、空间动量与动作链最小闭环；**候选实验行为，不构成正式规则晋升**。

### 设计与程序来源

- `i-scan/ProjectC:docs/VAL-012-thermal-clock-action-time-prototype-plan.md` revision 3；
- `i-scan/ProjectC:docs/VAL-012-unified-time-system-program-handoff.md` UT2；
- 页面入口：`#hex-prototype`；
- 实现标识：`action-chain-phase-v1`；
- 上一实验：`VAL-012-UT1 / unified-at-timeline-v1`。

### 动作语法与时序变化

- 动作从完整原子块扩展为 `Intro → Core AT Phase[] → Outro`；
- Core 内每个 Phase 保持连续、不可在中途插入普通世界事件；Actor Ready、Environment 与其他世界事件只在 Phase 边界结算；
- 新增 `Pending Momentum + Axis + Chain Window`，不使用额外正式术语 `Flow`；
- Chain Window 不推进世界时间，也不使用现实时间倒计时；玩家可无限思考，但下一动作一旦提交便继续全局 AT；
- Momentum 的职责限定为碰撞权威、转向/制动成本和后续动作资格；动作本身提供位移，不把 Momentum 线性叠加为通用额外移动。

### 当前固定闭环

- `Drive`：2 AT，由 `[Step 1 · 1 AT · M1] → [Dash 2 · 1 AT · M2]` 两个 Phase 组成；
- Drive Outro 保留 Axis，生成 `Pending Momentum 2` 并打开 Chain Window；
- `Rush Strike`：基础 2 AT，由 `[Start · 1 AT] → [Strike · 1 AT]` 组成；
- 当 Rush Strike 读取同轴 `Pending Momentum >= 1` 时跳过 Start，因此从 `AT2` 缩短为 `AT1`；
- 固定房间将玩家、轴线与目标布置为可重复的 E 轴链路；基础移动 / 攻击仍作为 1 AT 兼容动作，并支持点击相邻格直达。

### 边界与延期项

- 当前只落实 `Drive → Rush Strike`，不首轮实现 Raikiri、Anchor、完整动作库；
- 完整碰撞权威、复杂转向/制动、移动中 Contact 分支、复杂 Thermal 条件和实时 Chain 倒计时延期；
- UT1 Thermal 介入动作保留在折叠兼容区，不作为 UT2 动作链结论；
- Square4 与全局 `0.1.0` 继续作为历史快照，不受 UT2 覆盖。

### 验证状态

- [x] 独立 v2 实验配置、稳定 ruleset / implementation ID 与无通用 AP 声明；
- [x] 分段动作逐 Phase 推进全局 AT 并在边界处理队列事件；
- [x] Drive 生成 `Pending Momentum 2 / Axis E / Chain Window`；
- [x] 同轴 Rush Strike 跳过 Start，链路总时间为 `2 AT + 1 AT`；
- [x] 规则校验、Vitest、TypeScript、production build 与产物标记；
- [x] 1920 / 1366 宽度无头浏览器验证，并真实点击完成 `Drive E → Chain Window → Rush Strike AT1`；
- [ ] GitHub Actions、Pages commit 回读与线上浏览器闭环（合并后更新）。

对应 Validation：`VAL-012`。

---

## Experiment Ruleset `VAL-012-UT1` — 2026-08-06

### 类型

VAL-012 全局时间与 Action Time 统一原型；**候选实验行为，不构成正式规则晋升**。

### 设计与程序来源

- `i-scan/ProjectC:docs/VAL-012-thermal-clock-action-time-prototype-plan.md` revision 2；
- `i-scan/ProjectC:docs/VAL-012-unified-time-system-program-handoff.md`；
- 页面入口：`#hex-prototype`；
- 实现标识：`unified-at-timeline-v1`。

### 时序变化

- Hex6 当前实验移除通用 AP、保留 AP、玩家阶段结束与阶段式敌人结算；
- 新增单一 `worldTimeAt`、Actor `nextReadyAt` 与确定性 Event Queue；
- 玩家、敌人、NPC 与环境按同一队列排序，平手顺序为 Reaction → Contact → Landing → Actor Ready → Environment → stable ID；
- 玩家动作按 `1 / 2 / 3 AT` 完整原子结算，随后处理期间事件，直到玩家再次 Ready；
- Travel 每格固定为 `Quick Step · 1 AT`，与 Tactical 共用世界时间；
- Thermal Clock 按相同 AT 增量推进，当前基线周期保持 `8 AT`。

### 内容与 UI

- 当前十个介入动作改为固定手牌，不抽取、不弃置、不在回合开始补牌；
- 为现有测试动作登记候选 `1 / 2 / 3 AT`，用于比较轻动作灵活性与重动作不可分割价值；
- 页面常驻显示 World Time、Player Ready、Next Event、统一动作预览和期间事件；
- Thermal Inspector 改为 AT-only 表达，不再显示 AP / AT 并列费用。

### 边界

- Square4 与 `core-rules.v0.json` 继续保留旧 AP 规则作为历史快照；
- 当前 AT 值、敌人周期和环境周期都是 VAL-012 测试基线，不视为正式数值；
- Prepare / Release 仅以现有动作标签与 commit 类型参与首轮对照，尚未扩展正式内容库。

### 验证状态

- [x] 独立实验配置、稳定 ID 与无通用 AP 声明；
- [x] 队列排序、平手规则、期间事件预览与处理至玩家 Ready 的规则测试；
- [ ] 完整 Vitest、TypeScript 与 production build；
- [ ] 浏览器宽屏 / 窄屏与 2D / 3D 人工验收；
- [ ] GitHub Actions、PR 与 Pages commit 回读。

## Experiment Ruleset `val-012-tc1.0.1` — 2026-08-05

### 类型

VAL-012 TC1 的 Hex6 行动接入与 Inspector 布局修订；**候选实验行为，不构成正式规则晋升**。

### UI 与信息表达

- `Thermal Clock Inspector` 不再使用右上角独立浮层；
- 右侧栏新增 `Hex Inspector / Thermal Clock` 两个等宽选项卡，并在同一容器内互相切换；
- 右侧栏桌面宽度由原来的约 `285px` 调整为 `350px`，较窄桌面使用 `330px`；
- Thermal Clock 面板嵌入右侧栏，继承相同宽度、滚动区域和视觉层级；
- 角色卡上的 `TC1 Inspector` 按钮会直接切换右侧选项卡；
- Inspector 明确显示：
  - `1 Thermal Period = 4 Base Beats`；
  - `Base Beat AT = Thermal Period AT / 4`；
  - 8 AT 周期的锚点为 `0 / 2 / 4 / 6 / 8 AT`；
  - 12 AT 周期的锚点为 `0 / 3 / 6 / 9 / 12 AT`；
  - 动作预览显示本次 AT 相当于推进多少个 Base Beat；
- 8 AT 和 12 AT 不表示八个或十二个相位，只表示同一四相周期使用不同世界时间长度。

### Hex6 Tactical Action Time 接入

- 成功执行基础移动：`1 AP / 1 AT`；
- 成功执行基础攻击：`1 AP / 1 AT`；
- 成功打出当前 Hex6 卡牌：首轮采用 `Base AT = Base AP Cost`；
- 主动 `0 AP` 行动的通用桥接下限预留为 `1 AT`，Reaction 仍需显式声明 `0 AT`；
- 行动失败、目标无效或费用支付失败时，不推进 Thermal Clock；
- 卡牌或行动直接改变玩家 `bodyTemperature` 时，将该差值作为即时 `Delta Offset` 传入 TC1，然后再按 AT 推进；
- 当前旧卡牌没有正式 `Delta Drift` 数据，因此不会从卡牌名称或冷热标签推断 Drift；
- 连续快速行动会先提交前一次 Thermal 结果，再从更新后的状态继续推进；
- Hex6 悔棋会同步撤回对应的 Thermal Action；
- 重开地图、切换 Room / World 会同步重置 Thermal Clock 实验状态。

### 保留的 Debug 能力

- Inspector 内的 `Debug Resolve Action` 继续保留，用于测试 Direct Heat、Drift Impulse、Stabilize、0 AT Reaction、长动作和动作内事件；
- Debug Action 与真实卡牌 / 基础行动写入同一 Thermal 日志；
- Ghost preview 只在 `Thermal Clock` 选项卡活动时显示，避免 Hex Inspector 模式下常驻额外信息。

### 当前未接入

- Travel 每格移动与 Tactical AT 的换算尚未定义，因此旅行步骤暂不推进 TC1；
- Enemy Phase、NPC 行动和环境演算是否占用 Actor Thermal Clock 时间尚未确定，暂不自动接入；
- 当前桥接层只同步玩家行动产生的体温差值，不把 TC1 连续 Temperature 反写为旧战斗 GameState 的唯一温度权威；
- 正式卡牌 `baseActionTime` 字段尚未加入旧 `Card` 数据结构，当前使用首轮默认映射；
- Runtime Action 的确定性 Replay 数据结构仍待与正式 Action Record 合并，Debug Replay 保留为实验工具。

### 测试与验证

新增回归用例验证：

- 8 AT 周期仍为四个 Base Beat，锚点间隔为 2 AT；
- 12 AT 周期仍为四个 Base Beat，锚点间隔为 3 AT；
- Hex6 runtime bridge 保持 AP、AT、Delta Offset 相互独立；
- bridge 允许未来动作使用 `AP != AT`，不把二者硬编码为永久等式。

验证状态：

- [x] 右栏 Inspector 选项卡与统一宽度；
- [x] Thermal Clock 浮层改为嵌入式 Inspector；
- [x] 基础移动与攻击推进 1 AT；
- [x] 成功卡牌按首轮 Base AP → Base AT 映射推进；
- [x] 直接体温变化映射为即时 Delta Offset；
- [x] Hex6 Undo / Restart 同步；
- [x] 8 AT / 12 AT 相位间隔测试；
- [x] runtime action mapping 测试；
- [ ] 仓库内完整 `npm test`；
- [ ] 仓库内 `npm run build`；
- [ ] GitHub Actions 与 Pages 发布结果；
- [ ] 实际浏览器右栏宽度、滚动与选项卡切换；
- [ ] 旅行时间与 Tactical AT 的统一换算；
- [ ] 敌人、NPC 和环境事件的时间归属。

对应 Validation：`VAL-012`。

主要实现提交：

- `dd386ea4c3d1a69fbe39082d4b2eb9b061b40a46`：Hex6 Thermal Clock runtime signal 与 action mapping；
- `acd9b5696cc859679d4743ac4ff69bba347616fb`：嵌入式 Thermal Clock Inspector 与 AT / Base Beat 解释；
- `202a57fc31416d38bf5454224436c7d16c96a957`：钟摆消费真实 Hex6 行动、Undo 和 Restart；
- `f970fa47ce21eaa5d856ca6b31e85524c6f760c8`：Hex6 卡牌、移动、攻击与右栏选项卡接入；
- `f55f14d75d5bfff3f5c3d688d08988cc5339f41c`：右侧栏宽度与嵌入式 Inspector 样式；
- `f1feb01c6e5e52a195ea79d7d39f0d34ca0ad636`：加载 Inspector 布局样式；
- `fb03b98f03ceebd1cddc5dd756e1a306e9cd11f9`：runtime bridge 回归测试；
- `16005e269e9e943b6c4b73c6e0a37cfe50c60672`：8 / 12 AT 四相间隔回归测试；
- `7d4d672fa068eda00dd3d5e4030758133d4f25ac`：实验版本提升至 `val-012-tc1.0.1`。

---

## Experiment Ruleset `val-012-tc1.0.0` — 2026-08-04

### 类型

VAL-012 Thermal Clock 与 Action Time 新候选实验；**替换 Hex6 当前活动钟摆实验的执行模型，但不构成正式规则晋升**。

### 实验来源与身份

- 当前计划：`i-scan/ProjectC:docs/VAL-012-thermal-clock-action-time-prototype-plan.md`；
- Validation：`VAL-012`；
- Ruleset ID：`VAL-012-TC1`；
- Implementation ID：`thermal-clock-continuous-v1`；
- 活动阶段：`stage-1-thermal-clock-action-time`；
- 活动拓扑：Hex6-only；
- 独立配置：`config/experiments/val-012-thermal-clock-continuous.v1.json`。

旧离散实验 `val-012-stage1.0.1 / thermal-discrete-step-v1` 的配置、规则核心、测试与 Lab 文件继续保留，作为 `VAL-012-TD1` 历史对照，不在本次修改中静默覆盖或删除。

### 新 Thermal Clock 规则核心

- 持久状态改为连续的 `Set Point / Offset / Drift`；`Temperature = Set Point + Offset` 保持为派生结果；
- 使用固定周期的解析式振荡器推进状态，周期不随摆幅改变；
- 一个 Thermal Period 固定包含四个 Base Beat：
  1. `Hot Apex`；
  2. `Set Point → Cold`；
  3. `Cold Apex`；
  4. `Set Point → Hot`；
- 基准周期为 `8 AT`，同时提供 `4 AT` 与 `12 AT` 对照；
- `Projected Apex` 改为当前状态下第一个严格位于未来的 Apex；Actor 已处于 Apex 时，预测另一侧 Apex，而不是重复当前锚点；
- 长动作通过解析事件检测记录途中所有 Set Point Crossing、Hot / Cold Apex 与 Overshoot；
- 动作事件可以通过 `timeRatio` 插入动作时间线，并在事件前后继续使用同一 Thermal Clock 推进；
- 当动作事件恰好落在 Crossing 时，后续仍沿原方向推进会被正确记录为 Overshoot。

### AP、Action Time 与即时响应

- `AP` 与 `AT` 作为独立语义进入本实验；
- 动作先立即施加 `Delta Offset / Delta Drift / Stabilize`，钟摆即时更新；
- 随后世界时间按该动作 `baseActionTime` 推进，再得到下一决策点状态；
- `0 AP` 主动动作仍可以消耗 `1 AT`；
- Reaction 测试动作可以为 `0 AP / 0 AT`；
- 长动作可以在自身时间线中触发中途 Impact，而不是把全部结果压到动作末尾；
- 当前 `Base AT` 使用动作独立配置，不从折扣后的 AP 动态反推。

### Settle、Capture 与 Overshoot

- Strict Settle 只在 `Offset` 与 `Drift` 同时落入技术 epsilon 时成立；
- 技术 epsilon 只用于浮点稳定，不构成玩家可利用的 Capture Window；
- 默认规则 `captureThreshold = 0`；
- `Baseline · Capture 0.2` 仅作为独立可切换实验，不改变默认 Strict 规则；
- 抵达 Set Point 但仍保有 Drift 时不进入 Neutral；世界时间继续推进并进入另一侧时记录 Overshoot。

### 固定动作与场景

新增：

- `Flow 1 AT / Flow 2 AT`：只推进时间；
- `Direct Heat / Direct Cold`：立即改变 Offset；
- `Drift Hot / Drift Cold`：立即改变 Drift；
- `Stabilize`：立即削弱 Drift，再推进 1 AT；
- `Settle Reaction`：0 AT 取消 Drift，用于 Set Point 决策窗口；
- `Zero AP Active`：验证 `0 AP != 0 AT`；
- `Action Haste`：验证 `2 AP / 1 AT`；
- `Long Impact`：3 AT 动作，并在 70% 时间点触发 Impact Event；
- Hot Apex、两种 Crossing 方向、Settle Opportunity、Long Crossing、Warm Set Point 与 Neutral 等固定场景。

### Thermal Pendulum 与 Lab

- Hex6 当前活动钟摆切换到 TC1 连续状态；
- 摆锤在离散绝对温区内部连续移动，不再吸附到整数格心；
- Set Point 改变后，绝对温区仍保持等宽，摆锤极端中心继续限制在 `±84°`；
- 常驻信息保持为 bob、Set Point、Drift 与轻量四相进度；
- Projected Apex、精确数值、Period 和 World Time 收入折叠 Debug；
- Lab 默认关闭，只有打开 Lab 并选择动作时显示最终 ghost bob、ghost Drift 与动作途中锚点；
- Resolve 时先显示 Immediate 状态，短暂分层反馈后再写入 AT 推进后的最终状态；
- 新 `Thermal Clock Lab` 提供 Ruleset / Scenario、连续手动输入、AP/AT 动作列表、Now → Immediate → After AT 预览、时间线事件、Undo、Restart、Replay 与 Snapshot；
- 实验 Temperature 继续同步到 Hex6 Actor 卡显示，但尚未接入原有战斗 GameState。

### 自动覆盖与验证状态

新增测试覆盖：

- 固定四相与完整周期锚点；
- 周期与摆幅解耦；
- 当前 Apex 预测未来另一侧 Apex；
- Delta Offset / Delta Drift 的即时生效；
- AP 与 AT 独立；
- Strict Settle 与可选 Capture 分离；
- 长动作 Crossing / Overshoot / Action Event；
- 动作事件恰好落在 Crossing 时的 Overshoot；
- Warm Set Point、Neutral 与确定性 Replay；
- 连续摆锤角度、等宽温区、方向与边界裁切。

- [x] 新配置、规则核心、UI 映射、Lab、Portal 与测试文件已提交；
- [x] 在隔离 TypeScript 环境完成规则核心与 TSX 静态检查；
- [x] 在隔离 Node 环境完成四相、未来 Apex、即时响应、Strict / Capture、长动作 Overshoot 和摆锤映射断言；
- [ ] 仓库内 `npm run validate:rules`；
- [ ] 仓库内完整 `npm test`；
- [ ] 仓库内 `npm run build`；
- [ ] GitHub Actions 与 Pages 发布结果；
- [ ] 实际浏览器宽屏、窄屏、Immediate → AT 动画与 ghost 层级；
- [ ] 用户对 4 / 8 / 12 AT、Strict Settle、动作时间和信息密度的试玩反馈。

主要实现提交：

- `b27885ee743f90693702e0550292ae43a0ac69fa`：TC1 独立配置；
- `3d5020dfaabae95a6836d8a38a1d0fc6cf14eb6e`：连续 Thermal Clock 规则核心；
- `27d0c7b40b3c751db3942ff3898f88ad4ec67944`：规则与 Action Time 回归测试；
- `b21e1a045ba09658ea846ecaefe36c7ac932e706`：连续钟摆几何映射；
- `b7db0647b2133ea0e97d84cc0a96ffbc9e947224`：钟摆映射测试；
- `d2446484162d997d171bf7d51961008bd73f3dee`：Thermal Clock Lab；
- `57ff2cfce2f075c398464b1d0d0483197dcf4a3a`：TC1 视觉与响应样式；
- `0f99fb7c74f53b63cefcd71f06a16eed0e31a032`：Hex6 当前钟摆切换到 TC1。

---

## Experiment Ruleset `val-012-stage1.0.1` — 2026-08-03

### 类型

VAL-012 Stage 0 仪表基础与 Stage 1 Thermal Inertia 自然振荡实验；**候选玩法行为，不构成正式规则晋升**。

### 实验来源

- 当前计划：`i-scan/ProjectC:docs/VAL-012-dual-inertia-prototype-plan.md`；
- 活动阶段：`stage-1-thermal-inertia-natural-oscillation`；
- 活动拓扑：Hex6-only；
- 独立配置：`config/experiments/val-012-stage-1-thermal-inertia.v0.json`。

### 新增状态与规则核心

- 建立独立的 `ActorThermalState`：`Temperature / Set Point / Drift`；
- `Offset`、`Neutral`、side 与 `Projected Apex` 均保持为派生结果，不新增持久资源条；
- 每个 `Thermal Frame` 按以下顺序确定性结算：
  1. 读取 Frame 开始时的 `T / S / D`；
  2. 汇总一个测试动作的外部 `Thermal Impulse`；
  3. 按 Frame 开始时的 `Offset` 施加朝 Set Point 的 restoring force；
  4. 将 Drift 限制在 `-2 ～ +2`；
  5. Drift 非零时，Temperature 沿其方向移动一档；
  6. 判断 Crossing、Settle、Overshoot、Apex、Capture 和边界截断；
  7. 通过无新外力的纯函数模拟派生下一次 `Projected Apex`；
  8. 保存新的 Thermal State；
- `Temperature` 实验显示范围暂为 `-4 ～ +4`，用于降低边界对自然振荡首轮测试的干扰；
- 首轮不加入自动 Damping；
- `Neutral / Settle` 的严格条件为 `Temperature == Set Point && Drift == 0`；
- `Overshoot` 只有在携带 Crossing 上下文离开 Set Point 进入另一侧时才成立，不把“抵达 Set Point”本身误记为 Overshoot。

### Ruleset 对照

新增两套可切换的实验参数：

- `strict`：严格 Settle，不提供 Capture Window；
- `capture-window`：当 `Stabilize` 使 Actor 抵达 Set Point 且结算中剩余 `|Drift| == 1` 时，将 Drift 捕获为 `0` 并进入 Settle。

Capture Window 只用于比较“严格条件是否频繁差一档、形成维护税”，不是默认正式规则。

### 固定测试动作

- `Natural Step`：无外部 Thermal Impulse，只执行自然 restoring 与 Thermal Step；
- `Thermal Push Hot`：在 restoring 前施加 `+1` Thermal Impulse；
- `Thermal Push Cold`：在 restoring 前施加 `-1` Thermal Impulse；
- `Stabilizing Step`：先施加一个抵消当前 Drift 的 Impulse，再执行统一 Thermal Step；不直接写入 Settle 或 Overshoot 结果。

### 固定状态快照

- `T1 Natural Oscillation`：偏离 Set Point、Drift 为零；
- `T2A～T2D Phase Intervention`：当前侧扩张、Apex、回程、另一侧四种 Phase；
- `T3 Settle Capture`：比较 Strict 与 Capture Window；
- `T4 Deep Overshoot`：在 crossing 前后继续推拉 Drift，比较 Projected Apex 深度；
- `T1 Warm Set Point`：使用 `S = +1` 检查系统是否错误地把绝对 `0` 当作身体中心。

### Stage 0 仪表与调试能力

- Thermal Pendulum 不再从 Actor 卡 DOM 反向推导状态，而由独立实验 GameState 驱动；
- 当前摆锤显示 `Temperature`，弧形箭头显示保存的 `Drift`；
- 新增当前 `Projected Apex` 菱形标记；
- 选择测试动作后，同时显示 ghost bob、ghost Drift 与 ghost Apex，确认后才写入状态；
- Actor 卡保留紧凑钟摆与可开关的 `T / S / Offset / Drift / Apex / Frame` Debug；
- 新增独立浮层 `Thermal Inertia Lab`，提供：
  - Ruleset 切换；
  - T1～T4 固定快照；
  - 手动 T / S / Drift 输入；
  - 固定测试动作选择；
  - Ghost Resolution；
  - 单步 `Resolve Thermal Frame`；
  - Crossing / Settle / Overshoot / Apex / Capture / Boundary 事件标签；
  - Undo、Restart、确定性 Replay；
  - 完整 Frame 日志与 JSON Snapshot 复制；
- 实验 Temperature 会同步显示到 Hex6 Actor 卡的体温读数，但尚未接入原有战斗 GameState 的温度规则。

### 自动测试

新增回归用例验证：

- 配置、Ruleset、动作和场景 ID 唯一；
- restoring force 使用 Frame 开始时 Offset；
- T1 自然振荡具有确定路径和可预测 Apex；
- 相同 Temperature、不同 Drift 会产生不同结算和后续 Apex；
- Strict Settle 与 Capture Window 保持独立；
- Crossing 与 Overshoot 分两步记录；
- `T == S` 但 `D != 0` 不被误判为 Neutral；
- `S = +1` 时不把绝对零当作中心；
- Drift 与 Temperature 边界限制；
- 固定动作序列可确定性 Replay。

### 当前边界

- 本轮不加入 Kinetic Inertia、Axis、spatial Momentum、Drive、Redirect、Brake 或 Impact；
- 不加入敌人、环境、天气、物态网络或旧十张卡；
- 不把当前测试动作当作正式卡牌；
- 不实现动态 Set Point、完整极限温区惩罚或跨引擎正式数据包；
- Square4 不增加对应功能；
- 当前实验状态尚未替代旧 `core-rules.v0.json` 的全局 prototype-snapshot，也不自动晋升到 ProjectC `core-rules-spec.md`。

### 验证状态

- [x] 独立实验配置、稳定 ID 和固定快照；
- [x] Thermal Step 纯规则核心与确定性 Projected Apex；
- [x] Strict / Capture Window 对照；
- [x] Ghost preview、Frame log、Undo / Restart / Replay / Snapshot；
- [x] 规则级 Vitest 覆盖；
- [ ] GitHub Actions 测试与构建结果；
- [ ] 实际浏览器中浮层布局、ghost 信息层级与窄窗口可读性；
- [ ] T1～T4 人工试玩记录；
- [ ] 判断 Strict Settle 是否形成维护税；
- [ ] 判断相同 Temperature、不同 Drift 是否真实改变玩家选择；
- [ ] 判断 Projected Apex 是否足以避免玩家手算；
- [ ] 用户明确接受后的阶段性规则晋升。

对应 Validation：`VAL-012`。

主要实现提交：

- `56af94573f329879792192987ec34c0781338eb8`：独立实验配置与 T1～T4 快照；
- `f250fdd5e888341cfffd168cde147274f44ec2a6`：Thermal Inertia 规则核心；
- `25bca7d86bf92f0fac577b051641fec2769fea29`：规则回归测试；
- `a5302566a0db24b083c6741c053292b0fe3786e9`：钟摆实验状态、ghost 与 Apex 接入；
- `f37e588fd74d3fa00c88850935acd53fb8414d4d`：Thermal Inertia Lab；
- `2b6a4269f17d597a1e22d55dccd61835fe6c34cc`：实验面板与预览视觉样式。

---

## UI Prototype / Ruleset 0.1.0 — 2026-08-03

### 类型

VAL-012 Actor Heat 信息表达迭代；**无玩法行为变化**。

### 修改

- 在热力钟摆色温刻度下方增加弧形 Drift 向量；
- 当前原型直接复用既有动量 `momentum` 作为 Drift 数据源，不增加独立状态或测试滑杆；
- Drift 正值使用暖色向热侧展开，负值使用冷色向冷侧展开；
- Drift 长度表达动量绝对值，`1` 动量对应一个温度格的角宽 `12°`，显示长度在 `±3` 封顶；
- Drift 为 `0` 时，以 Set Point 正下方的灰点表示静止；
- 移除标题右侧原有“向热 / 向冷 / 静止”文字和小箭头，保留“热力钟摆”标题与折叠参数测试区；
- Drift 弧、摆锤和色温刻度继续共用同一套 SVG 极坐标方向，避免镜像映射。

### 当前边界

- `momentum` 与 Drift 暂时视为同一 UI 测试量；
- Drift 只表达方向与强度，不改变下一回合体温；
- Drift 不参与衰减、反转、推动、制动、释放或环境换热；
- 参数测试区仍使用现有“动量”滑杆，不增加重复的 Drift 控件；
- Square4 不增加对应功能。

### 验证

- [x] 正动量映射到暖色向热弧；
- [x] 负动量映射到冷色向冷弧；
- [x] 零动量映射到灰点；
- [x] 弧长按动量绝对值线性增长，并在 `±3` 封顶；
- [x] Drift 与 Set Point 改动相互独立，始终从物理最低点展开；
- [ ] 实际浏览器中的箭头尺寸、弧线间距与窄侧栏可读性；
- [ ] Drift 是否应在正式规则中与内部 momentum 拆分。

对应 Validation：`VAL-012`。

---

## UI Prototype / Ruleset 0.1.0 — 2026-08-02

### 类型

VAL-012 Actor Heat 信息表达验证；**无玩法行为变化**。

### 新增

- 在 Hex6 左侧 `Tactical Actor` 的 HP 与体温下方增加热力钟摆；
- 摆锤位置显示当前体温 `T`；
- 摆锤最低点显示可变 Thermal Set Point `S`，默认值为 `+1`；
- 仪表盘显示 `-3 ～ +3` 离散色温区和两侧极限区；
- 常驻显示摆动方向和精确动量读数；
- 增加折叠式 UI 参数测试区，可独立调整体温、Set Point 和动量；
- 增加摆锤角度、方向、色区和格式化的 Vitest 回归测试。

### 当前边界

- 当前动量只用于 UI 方向与读数测试；
- 角色体温发生离散变化时，以最近一次变化量更新显示动量；
- 动量不改变下一回合体温，不参与推动、制动、释放或环境交换；
- 阶段名称、温区收益、额外阈值和极限区规则均未锁定；
- Square4 不增加对应功能。

### 原因

在继续设计跨回合惯性和释放规则前，需要先验证玩家能否读懂“最低点是角色自身 Set Point，而不是固定 0”，以及方向、位置、色区和精确动量是否构成有效而不过载的信息组合。

### 验证

- [x] 默认温血 Set Point `+1` 映射到摆锤最低位置；
- [x] 冷热极限映射到相反两侧；
- [x] 动量符号映射到冷侧、静止和热侧；
- [x] UI 参数测试入口；
- [ ] 实际浏览器布局与窄侧栏可读性；
- [ ] 玩家是否需要常驻精确动量；
- [ ] Set Point 改变后，绝对温区与相对偏离是否同时清楚；
- [ ] 跨回合惯性规则。

对应 Validation：`VAL-012`。

---

## Schema 0.2.0 / Ruleset 0.1.0 — 2026-07-28

### 类型

文档权威与元数据校正；**无玩法行为变化**。

### 修改

- `schemaVersion`：`0.1.0 → 0.2.0`；
- 顶层 `status`：`prototype_hypothesis → prototype-snapshot`；
- `designReference`：从已被替代的 `docs/core-loop-and-rules.md` 改为 `docs/design.md`；
- 新增 `rulesReference`，指向 `docs/core-rules-spec.md`；
- 新增 `validationReference`，指向 `docs/core-rules-validation.md`；
- 新增 `implementationCommit`，记录本配置镜像的原型实现基线；
- Schema 状态词与 ProjectC 的统一状态词对齐。

### 原因

ProjectC 已确立 Design Bible、规则基准、验证记录和 WebPrototype 配置的分工。旧引用和旧状态词会造成误读，因此在配置进入 `main` 前统一修正。

### 验证

- [x] 精确玩法字段保持 ruleset `0.1.0` 不变；
- [x] Card、Actor、Equipment、AP、温度、地图和环境数值未改变；
- [ ] Schema 与引用完整性校验；
- [ ] Vitest 漂移测试；
- [ ] 构建。

---

## Ruleset 0.1.0 / Schema 0.1.0 — 2026-07-28

### 类型

初始配置基线。

### 新增

- 建立 `core-rules.v0.json`，镜像当前原型中的 AP、牌堆、十张卡牌、Actor、装备、温度、环境、Room / World 与山体规则；
- 建立 JSON Schema；
- 建立配置引用与硬编码漂移测试；
- 明确配置属于网页原型运行权威，而不是正式版本规则；
- 明确每次机制或数值实验都必须记录在本文件中。

### 当前镜像值

- 基础 AP 3，最多保留 1；
- 每消耗 1 AP，entropy +1；
- 温度范围 -3 ～ +3，普通直接修改 -2 ～ +2；
- 十张测试卡与固定初始牌序；
- 手牌补至 5，当前无随机洗牌；
- Water / Ice、Grass / Fire、Water / Cloud；
- 温差生风、Cloud、Rain intent 与 Cell → Actor 热交换；
- Hex6 Room R2 ～ R7，默认 R4；
- Hex6 World 16 × 12；
- Travel 每累计移动 baseAP 格推进一次世界 tick；
- Mountain 阻挡移动、路径、推击和直线攻击，暂不影响 Sky 天气。

### 对运行的影响

无玩法变化。本版本把现有代码值登记为配置基线，并增加漂移检测；GameState 和 Card Library 暂时仍由现有代码构建。

### 验证状态

- [x] JSON 与 Schema 已建立；
- [x] Card ID、牌序、Equipment 引用和 mode 引用具有自动检查；
- [x] 配置与现有 Card Library / GameState / Hex profile 具有回归对照；
- [ ] GameState 直接从配置构建；
- [ ] Card Library 直接从配置构建；
- [ ] 完成 R4 / R5 / R6 试玩对照；
- [ ] 第一批规则晋升到 ProjectC `core-rules-spec.md`。

### 后续版本候选

- `0.2.0`：用配置生成 Card Library、Actor 默认值和 GameConfig；
- `0.3.0`：根据 R4 / R5 / R6 对照调整 Range、AP 或环境覆盖；
- `1.0.0`：核心循环、Session 与 Shelter 实验形成完整可验证闭环。
