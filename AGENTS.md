# ProjectC Web Prototype Instructions

## Active scope

本仓库是 ProjectC 的 Cell World / Spatial Inertia 可执行验证环境。

当前阶段不是继续堆 runtime 补丁，而是：

```text
ProjectC Spatial Inertia v1 rules
→ Program04 review
→ implementation plan
→ runtime refactor
```

2026-08-30 之前的 WebPrototype runtime 仍是重要实验资产，但不再自动等于当前规则。

---

## Required reading

涉及 Momentum、Axis、Move、Wall、Collision、Knockback、Contact、Reachability 或 Travel 时，必须按顺序读取：

1. 本文件；
2. ProjectC `docs/VAL-012-spatial-inertia-rules-v1.md`；
3. ProjectC `docs/VAL-012-actor-loop-v0-program-handoff.md`；
4. ProjectC `docs/VAL-012-actor-loop-v0-prototype-plan.md`；
5. 本仓库 `README.md`；
6. `src/sim/cell-motion.js`、`src/sim/spatial-rules-v2.js`、`src/sim/conflict-v4.js` 与对应测试。

冲突时：

```text
最新用户明确修正
> ProjectC spatial-inertia-rules-v1
> current program handoff
> prototype runtime / old tests
```

禁止使用旧回归测试反向证明旧规则正确。

---

## Review-before-code rule

当前用户要求先把文档交由程序04评审。

因此在本轮评审明确通过前：

- 不修改 runtime 规则；
- 不为了让新文档“看起来通过”而改测试；
- 可以阅读代码、列差异、提出实现方案；
- 可以指出主规范中的循环依赖 / 不可实现边界；
- 不自动恢复旧 Adjacent Aim / post-spend Current M 规则。

程序04确认后再按仓库分支策略实施代码变更。

---

## Current canonical vocabulary

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

Basic Move、Drive、某张 Pierce 卡都是 Action，不是新的 MovementMode。

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

每次 M 变化必须能输出 `fromM / toM / cause`。

---

## Horizontal baseline

```text
M0 NoAxis
→ initiative Move1
→ M0 Axis

M0 Axis + same-axis Move1
→ Generate
→ M1

M1 + same-axis Move1
→ Generate
→ M2

M2
→ Basic Move cannot naturally Build M3

M3
→ requires Drive / Build Inertia / explicit rule
```

Default travel scale：

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

M0 Axis 不自然衰退。

---

## Action transaction timing

**当前 runtime 的 post-spend-first 规则已经不是目标规则。**

新主规范：

```text
Declare Action
→ no immediate M change
→ resolve first spatial event
```

一般第一次成功 Travel 后，只执行一次 Initiative Action Transaction。

例如：

```text
M3 → empty Cell
→ Use M3→M2
→ remaining route
```

但：

```text
M3 → adjacent Strike Target
→ Strike uses M3 before any normal Build / Use / Resist
```

如果 Strike 抢占了尚未发生的 Action Transaction，后续不补算原 transaction。

实现时需要显式 transaction state，不能靠 finalM 猜。

---

## Wall

目标规则：

```text
Wall = Redirect Axis only
Wall does not directly reduce M
Wall roundtrip = one Travel
```

Initiative M0：Wall target 不可提交，不耗 AT。

Build 已在撞墙前通过真实 Travel 成功，则保留 Build；紧邻 Wall 在 Build 前改变运动方向，则未发生的 Generate / Build 不成立，改为 Redirect。

Forced wall roundtrip 属于有效 Travel，因此第一次发生时执行 `Forced Use`。

Reflected Exit 非法时返回 Pre-wall Cell；Damage / Stun / Crash 不是 Wall Redirect 的默认副作用。

---

## Contact

### Strike

```text
Source current M
→ Incoming Target
→ Source M0
→ keep contact Axis
```

Target vacates Contact Cell：Source 进入该 Cell。

Target does not vacate：Source 回 Pre-contact Cell；Transfer 不退款。

默认 Strike 在 Contact Cell 停止 Source movement；特殊 Action 可覆盖。

### Pierce

```text
no Momentum Transfer
no Target knockback
keep Source M
continue route
```

Multi-cell Body 使用 footprint / exit legality；强制越过整个 Body 属于特殊技能能力。

不要为 Pierce 新建另一套 Move resolver。

---

## Forced Move

Forced 默认 Contact=Strike。

它也兑现 M：

```text
first Travel / first occupied travel attempt
→ Forced Use M→M-1 once
```

第一格就是 Actor 时 baseline：

```text
先 Forced Use
再 Strike Transfer
```

因此 M1 默认不能连续推动两个紧邻 M0 Target。

Chain 递归使用同一规则，不再保留独立 `chain-decay-prototype` 作为最终语义。

Forced Move 完成后保留最终 M / Axis，不自动归零。

---

## Incoming composition

Down：

```text
Down M 1:1 cancel Incoming Horizontal M
```

Existing Horizontal：程序需预留 A/B：

```text
True Vector Composition
Hex Angle Lookup
```

不得在评审阶段先把其中一种写死。

---

## M4 Overload

Solver 不应再假设系统绝对 maxM=3。

候选：

```text
Stable M <= 3
Transient Overload = M4
M4 forced travel baseline = 4
first Forced Use: M4→M3
Ready stable cap = M3
```

UI 候选：三个 Momentum dots 全红。

可保留 Clamp M3 为对照实验。

---

## Terrain extension

一般地面优先，但 Motion Resolver 需预留：

```text
travelCost / travelModifier per Cell
```

用于未来 Ice / low-friction 延长 Initiative inertia travel 与 Forced knockback。

不要通过 `M+1` 把地形效果硬编码进 Momentum 本体。

---

## State / presentation boundary

当前 runtime 仍可能使用：

```text
Position + Velocity + axisId + worldAt
```

这只是承载方式，不代表正式规则必须继续用连续 Velocity 保存全部 M。

表现层原则仍冻结：

- Three.js 不自行重算规则；
- React 不维护另一套路径；
- Preview / Commit 使用同一 solver；
- playback 不改变逻辑结果；
- 现有优秀曲线、墙体视觉和 causal playback 优先保留。

---

## Current implementation debt to review

当前 `main` 仍包含以下旧语义，程序04需要评审后再改：

1. hand-authored reachable envelopes；
2. action-start post-spend Current M；
3. Wall reflection 直接改变 M；
4. multiple actor collision models；
5. chain-decay prototype；
6. M2/M3 Build / Use 与新主规范不一致；
7. old tests 仍可能保护旧 Adjacent Aim / Current-M timing。

这些是待改项，不是当前权威规则。

---

## Regression principles after review

真正开始代码实现后，至少保持：

```text
pnpm test
pnpm build
pnpm verify:dist
pnpm verify:browser
```

但必须先更新错误的测试契约，再要求新实现通过。

必须保护的体验：

- click-to-select legal landing；
- clear reachable UI；
- high-M cannot stop on arbitrary path Cell；
- curved playback；
- Axis HUD / M dots；
- wall reflection visuals；
- actor causal playback；
- Preview / execution same solver。

---

## Documentation discipline

当前禁止恢复：

- `Basic Move = voluntary move + current velocity`；
- `M2+ always Range2`；
- `Action always pre-spends M before first contact`；
- `Wall itself always M-1`；
- `all Actor Contact = Collision`；
- `chain decay must be a separate hardcoded rule`；
- `Hot Side automatically lets Basic Move build M3`。

若程序04认为新主规范存在问题，先在评审中指出并回写 ProjectC 文档，再改 runtime。
