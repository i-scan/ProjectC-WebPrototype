# ProjectC Web Prototype · Spatial Inertia Control A/B Lab

本仓库是 ProjectC 的可执行规则实验环境。

当前最高优先级实验：

```text
VAL-012 Process Steering A/B

A = Reachable Shape
B = Process Steering / Persistent Motion
```

当前 Horizontal A/B 主源：

```text
ProjectC/docs/VAL-012-process-steering-ab.md
```

父级 Spatial 规则：

```text
ProjectC/docs/VAL-012-spatial-inertia-rules-v1.md
```

程序交接 / Gate：

```text
ProjectC/docs/VAL-012-actor-loop-v0-program-handoff.md
ProjectC/docs/VAL-012-actor-loop-v0-prototype-plan.md
```

---

## 为什么做这个 A/B

Reachable Shape 已经提供较好的传统战棋落点控制，但测试中仍存在：

- 高 M 转向困难主要由不可达 Cell 表达；
- M3 Move3 后进入 Ready 很像棋子停下；
- 高 M 输入窗口限制容易像 Action Lock；
- Horizontal M 的持续速度 / 身体历史表现不足。

因此 B 不删除 `M + Axis`，而是改写玩家控制方式：

```text
M / Axis = 已形成的持续运动状态
Action = 对这段运动施加控制
Landing = 过程结果
```

---

## A · Reachable Shape

继续保留当前可用对照：

```text
M / Axis
→ legal landing shape
→ click landing cell
→ deterministic Cell path
```

A 不应因为 B 的实现而被悄悄修改或删除。

---

## B · Process Steering

### Startup

```text
M0 NoAxis + Move
→ Move1 / 1AT
→ M0 Axis

M0 Axis + compatible Move
→ Move1 / 1AT
→ Generate M1
```

M1+ 表示 Persistent Horizontal Motion。

### Ready

```text
Action complete → Ready
Ready != stopped motion
```

Action 内 Cell Crossing 不产生 Input Window。

### Steering

```text
Yellow Arrow = Current Axis
Blue Arrow = Steering Intent
Basic authority = <=60° / Action
```

不是 `60° / Cell`。

Axis 在整个 Action Duration 内持续朝 Blue 响应。

如果 Passive Dissipation 后 `M→0`，允许额外最多 60° no-travel Axis settlement，保证低 M 灵活性。

### Preview

B 必须同时显示：

```text
Coast Projection
Controlled Projection
```

玩家应该在 Commit 前直接看到“如果不干预会去哪”与“这次 Steering 把未来改到哪里”。

---

## Travel / Dissipation baseline

目标 Band：

```text
M0 active Move = 1 Cell / AT
M1 ≈ 1 Cell / AT
M2 ≈ 2 Cells / AT
M3 ≈ 3 Cells / AT
```

B 的 Cell Crossing 从 1AT 内运动过程求出，不依赖 A 的 authored Reachable Shape。

第一轮：

```text
unsustained Action end
→ Passive Dissipation -1M
```

```text
Move / Steer = active direction control, no automatic sustain
Skip / Coast = no active control, no sustain
Drive / Build effect = later sustain / build hook
```

实现需预留 Resistance：

```text
baseDissipationPerAction
terrainDissipationModifier
sustainModifier
```

Normal baseline=1。

Ice 最终值仍待后续比较：

```text
Normal1 / Ice0
vs
Normal2 / Ice1
```

---

## Dynamic labels

不新增独立 Coast 卡牌。

```text
M0:
Move / Wait

Horizontal M>0:
Steer / Coast
```

底层 Action 可以共享，UI 负责表达当前运动语义。

---

## Frozen-speed presentation

B 的世界暂停必须尝试表现为“高速摄影冻结”，而不是停车。

最低使用：

- Yellow Axis；
- M dots；
- Coast line；
- previous motion trail / ghost samples；
- 高 M 更明显的 trail / arrow / stretch；
- Blue Steering + Controlled line。

网页圆形 Actor 本身就是本轮验证对象：如果这些低成本元素仍无法让 Ready 看起来像持续运动，B 会得到重要负面证据。

---

## Down / Spatial parent rules

Down Axis 保留：

```text
Horizontal Axis + M = persistent planar motion
Down Axis + M = grounded / stability commitment
```

ContactBehavior、Forced Use、Wall、M4 等仍由 `VAL-012-spatial-inertia-rules-v1.md` 负责；它们不需要先全部重构才能测试 B。

---

## 当前实现顺序

```text
A/B selector
→ keep A stable
→ B startup / persistent motion
→ Yellow / Blue steering
→ Coast + Controlled projection
→ 60° / Action
→ zero-M settlement
→ Passive Dissipation / Resistance hook
→ frozen-speed visual
→ playtest
```

先不要把范围扩张到完整 Strike / Pierce / Chain / M4 / Ice / Attack / Drive 平衡。

需要高 M 时使用 Debug preset。

---

## Regression

```bash
pnpm test
pnpm build
pnpm verify:dist
pnpm verify:browser
```

A/B 第一轮至少验证：

1. M0 startup；
2. M1/M2/M3 Coast；
3. M1/M2/M3 Steering；
4. `<=60° / Action` 与 Cell 数无关；
5. zero-M settlement 不增加 Travel；
6. Preview == Commit；
7. M3 stopping distance；
8. A/B test isolation；
9. 当前 board / HUD / playback 基础功能不回归。

Pages 只有 unit / build / dist / real Chrome / deploy / published commit verification 全部成功后才算落实。

Process Steering 即使实现成功也仍是 `candidate`，必须通过实际试玩和 A/B 比较后才能决定是否替换 Reachable Shape。
