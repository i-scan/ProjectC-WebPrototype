# ProjectC Web Prototype Instructions

## Active scope

本仓库是 ProjectC 的 Cell World / Spatial Inertia 可执行验证环境。

2026-08-30 起，活动 runtime 迁移目标为：

```text
ProjectC Spatial Inertia v1
→ shared Initiative / Forced movement grammar
→ transaction timing
→ ContactBehavior
→ CellMotionTrace
```

此前 WebPrototype 的 landing-cell input、Reachable envelope、曲线、Wall pivot、Actor causal playback 等属于要保留的实验资产；旧 Momentum / Collision 解释不是权威规则。

---

## Required reading

涉及 Momentum、Axis、Move、Wall、Collision、Knockback、Contact、Reachability 或 Travel 时，必须按顺序读取：

1. 本文件；
2. ProjectC `docs/VAL-012-spatial-inertia-rules-v1.md`；
3. ProjectC `docs/VAL-012-actor-loop-v0-program-handoff.md`；
4. ProjectC `docs/VAL-012-actor-loop-v0-prototype-plan.md`；
5. 本仓库 `README.md`；
6. `src/sim/spatial-inertia-v1.js`、`src/sim/cell-motion.js`、`src/sim/conflict-v5.js` 与对应测试。

冲突时：

```text
最新用户明确修正
> ProjectC spatial-inertia-rules-v1
> current program handoff
> current v1 tests
> pre-v1 runtime / old tests
```

禁止使用旧回归测试反向恢复已经否定的旧规则。

---

## Canonical vocabulary

### Momentum

```text
M = discrete momentum magnitude
Stable Actor M = M0~M3
Transient Overload = M4
```

### MovementMode

底层只分：

```text
Initiative Move
Forced Move
```

Basic Move、Drive、Pierce card 等是 Action，不是新的 MovementMode。

### ContactBehavior

```text
Strike
Pierce
future: Grab / Throw / Special
```

Actor Contact 不自动等于 Momentum Collision。

### Momentum Event Cause

至少：

```text
Generate
Use
Redirect
Resist
Forced Use
Transfer
Passive Dissipation
Convert
Release
```

每次 M 变化必须可输出 `fromM / toM / cause`。Thermal 应读取 Cause，而不是从 `M 增/减` 反推行为语义。

---

## Horizontal baseline

```text
M0 NoAxis
→ Initiative Move1
→ M0 Axis

M0 Axis + same-axis Move1
→ Generate
→ M1

M1 + same-axis Move1
→ Generate
→ M2

Basic M2
→ cannot naturally Build M3

M3
→ requires Drive / Build Inertia / explicit rule
```

Default Initiative Travel：

```text
M0 Move1
M1 Move1
M2 Move2
M3 Move3
```

M1 special：

```text
±60°  → Move1 / Redirect / M1
±120° → real Travel2 / Resist / M0 / new Axis
```

因此绝对禁止重新引入“remaining travel 永远 <= Current M”的全局假设；M1 ±120° 本身就是反例。

M0 Axis 不自然衰退。

---

## Initiative transaction timing

**Action Declare 不立即结算 M。**

```text
Declare Action
→ keep current M
→ resolve first spatial event
```

通常第一次成功 Travel 后，只执行一次 Initiative Action Transaction。

```text
M3 → empty Cell
→ successful Travel
→ Use M3→M2
→ remaining route
```

但 priority Contact 可以抢占尚未提交的 transaction：

```text
M3 → adjacent Strike Target
→ no successful Travel yet
→ Strike uses M3
→ pending Basic transaction is preempted
```

若先通过空 Cell：

```text
M3 → empty Cell
→ transaction commits M3→M2
→ later Strike uses M2
```

实现必须显式记录 transaction state；禁止再用最终 `finalM` 猜当前事件应该读哪个 M。

Generate / Build 同样只有在要求的真实 Travel 完成后才成立。

---

## Wall / Boundary

基础 Surface 语义：

```text
Surface = Redirect Axis
Surface itself does not directly reduce M
```

Internal Wall Cell：

```text
pre-wall Cell
→ wall pivot
→ reflected exit
= one successful Travel
```

Wall pivot 不是合法 landing Cell。

M0 Initiative：主动向 Wall / Surface 的提交不可成立，不耗 AT。

如果 Generate / Build 前就被紧邻 Surface 改变运动方向，则未发生的 Build 不成立，可降级为 Redirect；若 Build 已在前一个真实 Travel 成功，则之后碰墙不退款。

Forced wall roundtrip 在第一次发生时属于有效 Travel，因此执行一次 Forced Use。

Reflected exit 非法 / 被占用时按 Contact 与 exit legality 处理；Damage / Stun / Crash 不是默认 Surface Momentum 规则。

Boundary 默认服从相同“Redirect only / no direct M loss”语法。

---

## Contact

### Strike

```text
Source current M
→ Incoming Target
→ Source M0
→ keep contact Axis
```

Target vacates Contact Cell：Source 可以进入该 Cell。

Target does not vacate：Source 返回 pre-contact Cell；Transfer 不退款。

默认 Strike 在 Contact 停止 Source movement；特殊 Action 可显式覆盖。

**禁止把 equal-mass restitution helper 当作正式 Strike。** `exchangeActorMomentum()` 可以保留做数值对照，但 v1 Contact resolver 不应调用它作为默认规则。

### Pierce

```text
no Momentum Transfer
no Target knockback
keep Source M
continue route
```

Multi-cell Body 使用 footprint / exit legality；强制越过整个 Body 属于特殊技能能力。

Pierce 必须接入同一个 Contact resolver，禁止创建第二套 Move / collision solver。

---

## Forced Move

Forced 默认 ContactBehavior = Strike。

第一次有效 Travel，或第一格 occupied travel attempt：

```text
Forced Use M→M-1 once
```

occupied first Cell 的顺序：

```text
Forced Use
→ Contact / Strike Transfer
```

因此 chain decay 必须自然来自递归执行同一套规则：

```text
Incoming M3
→ Forced Use M2
→ Transfer M2
→ next Incoming M2
→ Forced Use M1
→ Transfer M1
→ next Incoming M1
→ Forced Use M0
→ stop
```

禁止恢复独立 `chain-decay-prototype`。

Forced Move 完成后保留最终 M / Axis，不自动归零。

Surface reflection 不额外扣 M。

---

## Incoming composition

Down：

```text
Down M 1:1 cancel Incoming Horizontal M
```

Existing Horizontal 必须保留 A/B：

```text
True Vector Composition
Hex Angle Lookup
```

当前 `Hex Angle Lookup` 的具体表属于 `prototype-candidate`，不是 ProjectC 已冻结规则。不得因为代码存在就回写成唯一正式模型。

---

## Drive candidate

ProjectC 主规范确认：M3 需要 Drive / Build Inertia / explicit rule，但没有冻结当前测试 Drive 的最终数值。

WebPrototype 当前候选：

```text
Drive = Build Inertia +1M
stable cap M3
commit after first successful Travel
no retroactive expansion of the already declared route
```

例如 M2 Drive 仍提交 M2 的 Travel2 route；第一次成功 Travel 后变 M3，但本 Action 不因此临时扩展为 Travel3。

所有相关代码 / UI / tests 必须保留 `prototype-candidate` 标记，直到用户 / 策划明确冻结。

---

## M4 Overload

Solver 体系不能假设系统绝对 maxM=3。

候选：

```text
Stable M <= 3
Transient Overload = M4
M4 forced travel baseline = 4
first Forced Use: M4→M3
Ready stable cap = M3
```

当前 runtime 已允许 Incoming composition 产生 M4，并保留 Forced Move 逻辑接口；Ready settle 时点、UI 和底层 trace 完整 M4 debug 显示仍是待闭环项。

不得为了省事直接在 Incoming composition 入口 clamp 到 M3。

---

## Terrain extension

Motion Resolver 需要继续演进到支持：

```text
travelCost / travelModifier per Cell
```

用于未来 Ice / low-friction 延长 Initiative / Forced Travel。

不要通过 `M+1` 把 Terrain effect 硬编码进 Momentum 本体。

实际 Ice 数值尚未冻结，不允许程序自行决定。

---

## State / presentation boundary

当前承载仍可能使用：

```text
Position + Velocity + axisId + worldAt
```

但 Spatial v1 gameplay authority 应逐步收束到离散 `M + Axis + Cell`。连续 Velocity 可以继续承担旧 Action / Hybrid presentation 兼容，不得覆盖已计算出的 v1 逻辑结果。

表现层原则：

- Three.js 不自行重算规则；
- React 不维护另一套路径；
- Preview / Commit 使用同一 solver；
- Basic / Drive 的 Discrete / Hybrid 必须共享同一逻辑 Cell path / final M / final Axis；
- playback 不改变逻辑结果；
- 现有曲线、墙体视觉和 causal playback 优先保留。

---

## Active implementation

当前 v1 runtime 入口：

```text
src/sim/spatial-rules.js
→ spatial-inertia-v1.js

src/sim/conflict.js
→ conflict-output-v1.js
→ conflict-v5.js
```

`spatial-rules-v2.js / conflict-v4.js` 属于 pre-v1 historical implementation，不得作为新规则依据。

已迁移：

- landing envelope / low-M startup；
- Initiative transaction timing；
- M1 ±60 / ±120；
- Basic M2/M3 transaction baseline；
- Wall / Boundary Redirect only；
- Strike direct Transfer；
- Forced Use recursive chain；
- Incoming True Vector / Hex Lookup calculation entry；
- transient M4 representation；
- Basic / Drive shared logical path across Discrete / Hybrid。

仍属扩展 / 未闭环：

- Drive 最终数值；
- Incoming A/B winner / Hex table；
- Pierce live Action；
- M4 Ready settle / UI；
- Terrain travel modifier；
- full discrete-M authoritative state migration；
- Heavy Drive / Hard Turn 等旧实验 Action 的 v1 语义。

---

## Regression gates

Movement / Contact 修改至少必须通过：

```text
pnpm test
pnpm build
pnpm verify:dist
pnpm verify:browser
```

必须保护：

- click-to-select legal landing；
- clear reachable UI；
- high-M cannot stop on arbitrary path Cell；
- M1 ±120 real Travel2；
- first Travel transaction timing；
- adjacent Strike preemption；
- wall roundtrip cost1 / no direct wall M loss；
- Strike Source→M0 / Transfer no refund；
- Forced Use chain；
- curved playback；
- Axis HUD / M dots；
- actor causal playback；
- Preview / execution same solver。

旧 tests 如果保护以下语义，必须更新而不是恢复实现：

- post-spend-before-first-contact；
- Wall M-1 / restitution→M；
- equal-mass default Strike；
- separate chain decay；
- Basic natural M2→M3。

---

## Documentation discipline

禁止恢复：

- `Basic Move = voluntary move + current velocity`；
- `M2+ always Range2`；
- `Action always pre-spends M before first contact`；
- `Wall itself always M-1`；
- `all Actor Contact = Collision`；
- `chain decay must be a separate hardcoded rule`；
- `Hot Side automatically lets Basic Move build M3`。

候选规则必须明确标记 candidate，不得因为 WebPrototype 实现了就自动升级为 ProjectC canonical rule。

Pages 只有在 unit / build / dist / real Chrome / deploy / published commit 全部成功后才算完成发布。
