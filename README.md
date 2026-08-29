# ProjectC Web Prototype · Spatial Inertia Lab

本仓库是 ProjectC 的可执行规则实验环境。

当前状态：

```text
2026-08-30 Spatial Inertia v1 文档已完成
→ Program04 先评审
→ 暂未实施 runtime 规则重构
```

因此当前网页依然代表 **pre-v1 prototype snapshot**。它的操作手感、CellMotionTrace、Wall / Actor playback 是重要资产，但规则语义不能反向覆盖 ProjectC 最新主规范。

当前唯一 Spatial Inertia 规则主源：

```text
ProjectC/docs/VAL-012-spatial-inertia-rules-v1.md
```

程序交接：

```text
ProjectC/docs/VAL-012-actor-loop-v0-program-handoff.md
```

原型 Gate：

```text
ProjectC/docs/VAL-012-actor-loop-v0-prototype-plan.md
```

---

## 当前网页已经做得好的部分

优先保留：

- click-to-select legal landing；
- M / Axis HUD；
- 高 M 的前向 Reachable 约束；
- 不能任意停在路径中间 Cell；
- 多 Cell 曲线路径；
- Wall pivot / reflection 视觉；
- Actor knockback / causal chain playback；
- Preview 与 execution 共用 solver；
- AT / Thermal playback 基础设施；
- `CellMotionTrace` 逐 Cell 记录方向。

下一轮不是推倒这些体验，而是让它们服从统一规则。

---

## 当前 runtime 与新规则的主要差异

当前 `main` 仍包含：

```text
hand-authored Reachable Envelope
post-spend Current M before first collision
Wall reflection can reduce M directly
multiple Actor collision / chain models
legacy Basic / Drive semantics
```

新规则要求：

```text
MovementMode = Initiative / Forced
ContactBehavior = Strike / Pierce / ...
Action declare 不预先结算 M
first Travel / priority Contact 决定 transaction timing
Wall = Redirect only
Forced Move 有一次 Forced Use
Chain 递归使用同一 Transfer
M4 transient overload
Terrain travel modifier extension
```

当前 runtime 尚未完成这些修改。

---

## Spatial Inertia v1 快速摘要

### Momentum

```text
M = discrete momentum magnitude
Stable Actor M = M0~M3
Transient Overload = M4
```

Horizontal state：

```text
M0 NoAxis
→ M0 Axis
→ M1
→ M2
→ M3
```

Basic Move 自然 Build 到 M2；M3 需要 Drive / Build Inertia Action 等显式方式。

Default travel：

```text
M0 Move1
M1 Move1
M2 Move2
M3 Move3
```

M1：

```text
same Axis → Generate M2
±60° → Redirect / M1
±120° → real Travel2 / Resist / M0 / new Axis
```

---

## Initiative / Forced

底层只分两种移动来源：

```text
Initiative Move
Forced Move
```

Basic Move / Drive / 各种卡牌都是 Action，不是新的 movement type。

Forced Move 默认 Contact=Strike，并在第一次 Travel / 第一格 occupied attempt 时：

```text
Forced Use M→M-1 once
```

因此连续 knockback chain 会自然衰减。

---

## Contact

Actor Contact 不自动等于 Collision。

### Strike

```text
Source current M
→ Incoming Target
→ Source M0
```

Target 腾空 → Source 进入 Contact Cell；未腾空 → Source 返回 Pre-contact Cell。

### Pierce

```text
no M transfer
no Target knockback
Source keeps M
continue route
```

Multi-cell Body 通过 footprint / exit legality 处理。

---

## Wall

目标规则：

```text
Wall = Redirect Axis only
Wall roundtrip = one Travel
Wall itself does not M-1
```

M0 Initiative 不允许提交向 Wall 的移动，也不浪费 AT。

当前网页尚未按此规则重构。

---

## Incoming / M4

Down：

```text
Down M 1:1 cancel Incoming Horizontal M
```

Horizontal existing + incoming：待 A/B：

```text
True Vector Composition
Hex Angle Lookup
```

M4：

```text
system transient overload
first Forced Use M4→M3
stable Ready cap M3
```

UI 候选：三个 M 点全部变红。

---

## Terrain / Ice

当前一般地面优先。

Resolver 需要预留：

```text
travelCost / travelModifier per Cell
```

未来 Ice 可以让同样的 M 兑现更长 Initiative / Forced Travel，而不是简单增加 M。

---

## 当前 Debug / Runtime

页面仍包含：

- Inertia Driving Lab；
- Hex6 Cell World；
- Discrete / Hybrid A/B；
- Momentum / Impulse actions；
- Axis HUD / M dots；
- Thermal Pendulum；
- Cell Inspector；
- Collision / board radius / playback debug；
- Undo / Reset。

浏览器 Debug API 仍以当前 runtime 为准；在 Spatial v1 实施前，不应把现有 API 输出视为新规则证据。

---

## 回归命令

真正开始 runtime 修改后继续使用：

```bash
pnpm test
pnpm build
pnpm verify:dist
pnpm verify:browser
```

但程序04必须先识别并更新保护旧错误语义的 tests，再用新门禁判断实现是否正确。

---

## GitHub Pages

`main` push 当前仍会运行现有自动化发布链。

文档更新不代表网页 runtime 已变化。

只有完成：

```text
rule implementation
→ tests
→ build
→ browser verification
→ Pages deploy
→ published commit verification
```

之后，才能说网页已经落实 Spatial Inertia v1。

---

## 当前任务

现在请先做程序04评审，不直接改 runtime：

1. 读 ProjectC Spatial Inertia v1；
2. 对照 `cell-motion.js / spatial-rules-v2.js / conflict-v4.js`；
3. 标出实现冲突和循环依赖；
4. 给出最小风险改造顺序；
5. 确认后再进入代码实施。
