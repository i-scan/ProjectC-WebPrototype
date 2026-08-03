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
