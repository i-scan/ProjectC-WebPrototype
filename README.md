# ProjectC Web Prototype · Spatial Inertia v1 Lab

本仓库是 ProjectC 的可执行规则实验环境。

当前分支正在落实 2026-08-30 完成规范化的 **Spatial Inertia v1 candidate runtime**。唯一 Spatial Inertia 规则主源仍是：

```text
ProjectC/docs/VAL-012-spatial-inertia-rules-v1.md
```

程序交接与原型 Gate：

```text
ProjectC/docs/VAL-012-actor-loop-v0-program-handoff.md
ProjectC/docs/VAL-012-actor-loop-v0-prototype-plan.md
```

本轮不是推倒此前原型，而是保留已经验证有效的 landing-cell 操作、Reachable envelope、CellMotionTrace、Wall pivot、曲线 playback 与 Actor causal playback，同时把它们收束到统一的 Spatial Inertia 语法。

---

## 当前 v1 runtime 主结构

```text
Action
→ Initiative Transaction
→ CellMotionTrace / Travel
→ ContactBehavior
→ Forced Move
→ Momentum Event Log
```

底层移动来源只分：

```text
Initiative Move
Forced Move
```

Basic Move / Drive / 后续卡牌是 Action，不再各自拥有独立的碰撞或击退物理。

---

## Momentum / Travel baseline

稳定状态：

```text
M0~M3
```

系统允许 transient：

```text
M4 Overload
```

默认 Initiative Travel：

```text
M0 Move1
M1 Move1
M2 Move2
M3 Move3
```

低 M 启动：

```text
M0 NoAxis + Move1
→ establish Axis / M0

M0 Axis + same-axis Move1
→ Generate M0→M1

M1 + same-axis Move1
→ Generate M1→M2

M1 ±60°
→ Move1 / Redirect / keep M1

M1 ±120°
→ real Travel2 / Resist / M1→M0 / new Axis
```

Basic Move 自然 Build 到 M2；不会自然从 M2 Build 到 M3。

M2 / M3 当前 baseline：

```text
one Initiative transaction per Action
M2 → M1
M3 → M2
```

已经验证有效的五格前向 landing envelope 与“不能任意停在中间 Cell”继续保留。

---

## Transaction timing

v1 明确废弃旧的 action-start post-spend 解释。

```text
Declare Action
→ 不立即改变 M
→ resolve first spatial event
```

通常第一次成功 Travel 后提交一次 Action Transaction。

因此：

```text
M3 → empty first Cell
→ Use M3→M2
→ 后续 Contact 使用 M2
```

但：

```text
M3 → adjacent Strike Target
→ 尚未发生 Travel
→ Strike 直接使用 M3
→ pending Basic transaction 被 Contact 抢占，不再补算
```

这条时序是本轮从原型问题中规范化出的关键修正。

---

## Wall / Boundary

当前 v1 baseline：

```text
Surface = Redirect Axis
Surface itself does not directly reduce M
```

Wall Cell roundtrip：

```text
pre-wall Cell
→ wall pivot
→ mirrored exit
= one Travel
```

因此 Wall 不再拥有额外 `M-1` 或 restitution→M 的独立规则。若同一个 Basic Action 最终发生 `M3→M2`，它来自该 Action 的一次 Initiative transaction，而不是 Wall 税。

M0 Initiative 不能主动提交 Wall reflection。

Boundary 使用同一“surface redirects Axis, no direct M loss”基线。

---

## Contact / Strike

Actor Contact 先解析 `ContactBehavior`。

当前正式接入：

### Strike

```text
Source current M
→ Transfer as Incoming to Target
→ Source M0
→ Source 默认在 Contact 停止
```

Target 腾空 Contact Cell：Source 可进入；Target 未腾空：Source 返回 pre-contact Cell，但 Transfer 不退款。

旧 equal-mass restitution helper 仍保留用于数值对照，但 v1 正式 Contact resolver 不再调用它。

### Pierce

主规范已经定义：

```text
no Momentum Transfer
no Target knockback
Source keeps M
continue route
```

当前没有 live Action 使用 Pierce，因此本轮核心 runtime 暂未暴露 Pierce 卡面；后续必须接入同一个 Contact resolver，禁止另建移动系统。

---

## Forced Move / Knockback

Forced Move 默认 ContactBehavior = Strike。

第一次有效 Travel，或第一格 occupied travel attempt：

```text
Forced Use M→M-1 once
```

随后再处理该 Cell 的 Contact。

因此 chain decay 不再硬编码：

```text
Incoming M3
→ Forced Use M2
→ Strike transfer M2
→ next Target Forced Use M1
→ Strike transfer M1
→ next Target Forced Use M0
→ chain stops
```

Wall reflection 不产生第二笔 M 损失。

---

## Incoming A/B

Down：

```text
Down M 1:1 cancel Incoming Horizontal M
```

Existing Horizontal + Incoming 当前保留两种实验模型：

```text
A. True Vector Composition
B. Hex Angle Lookup
```

runtime 已同时实现两种计算入口；**尚未冻结赢家**。

Hex Lookup 当前数值表明确标记为 `prototype-candidate`，不能反向写成正式设计结论。

---

## M4 Overload

runtime 已允许 Incoming composition 产生 transient M4，并为 Forced Move 保留 Travel4 / first Forced Use M4→M3 的逻辑接口。

仍未完全闭环：

- Ready 阶段统一 settle M4→M3 的正式时点；
- M4 的最终 UI 表现；
- `CellMotionTrace` 内部 M 上限完全扩展到 4 的调试显示。

这些属于后续候选，不应阻塞 M0~M3 v1 核心验证。

---

## Drive：当前 prototype candidate

主规范明确 Drive / Build Inertia 是进入 M3 的显式方式，但没有冻结这张测试 Action 的最终数值。

本原型当前采用：

```text
Drive
→ Build Inertia +1M
→ stable cap M3
→ 第一次成功 Travel 后提交
→ 不倒推扩大本次已经声明的 Travel route
```

例如 M2 Drive：

```text
按当前 M2 landing route Travel2
first successful Travel 后 M2→M3
本次仍只完成已声明的 Travel2
```

此规则带有 `prototype-candidate` 标记，后续试玩可以调整。

---

## Terrain / Ice extension

主规范要求未来支持：

```text
travelCost / travelModifier per Cell
```

当前一般地面仍按 cost 1 验证。Ice 最终数值尚未冻结，因此本轮没有用 `M+1` 伪造地形效果。

这仍是一个需要继续接入 CellMotionTrace 的实现扩展点。

---

## Discrete / Hybrid

Basic Move 与 Drive 现在共享同一份 v1 逻辑路径与最终 Cell / M / Axis。

```text
Discrete / Hybrid
= presentation A/B
≠ two rule systems
```

Hybrid 可以继续使用更平滑的曲线表现，但不得重新通过独立 `Velocity + ΔV` 求解另一套 gameplay 结果。

尚未迁移到 v1 的 Heavy Drive / Hard Turn 等旧实验 Action 会明确留在 legacy path，不允许静默冒充已经规范化的规则。

---

## Debug / regression

核心回归：

```bash
pnpm test
pnpm build
pnpm verify:dist
pnpm verify:browser
```

必须持续保护：

- landing-cell input / reachable envelope；
- M1 ±60 / ±120；
- first-Travel transaction timing；
- adjacent Strike preemption；
- Wall roundtrip cost 1 / no direct M loss；
- Strike direct Transfer；
- Forced Use recursive chain；
- Preview / execution same solver；
- curved wall / actor playback；
- Axis HUD / M dots / Thermal timebase。

不得恢复：

- action-start post-spend；
- Wall itself M-1；
- equal-mass collision 作为默认 Strike；
- `chain-decay-prototype`；
- Basic M2 natural build to M3。

---

## 尚未闭环的规则 / 实验项

当前明确保留为候选而非正式冻结：

1. Drive 最终 Build 数值与 card cost；
2. Existing Horizontal + Incoming：True Vector vs Hex Lookup；
3. Hex Lookup 的最终角度表；
4. M4 Ready settle 与 UI；
5. Terrain/Ice 的实际 travel modifier；
6. 尚无 live card 的 Pierce / 未来 Grab / Throw；
7. 正式 gameplay state 最终是否彻底从连续 Velocity 切换为离散 `M + Axis` 权威状态。

这些点应继续通过网页原型 A/B 验证，而不是由程序层擅自冻结。

---

## GitHub Pages

只有完整完成：

```text
rule implementation
→ unit tests
→ production build
→ dist verification
→ real Chrome verification
→ Pages deploy
→ published commit verification
```

才能声称网页端已落实到对应 commit。
