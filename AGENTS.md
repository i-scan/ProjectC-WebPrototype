# ProjectC Web Prototype Instructions

## Active scope

本仓库当前是 ProjectC 的 Cell World / Spatial Inertia 可执行验证环境。

2026-09-04 起，最高优先级不再是继续扩大 Wall / Contact / Forced runtime 重构，而是先完成：

```text
VAL-012 Process Steering A/B

A = Reachable Shape
B = Process Steering / Persistent Motion
```

B 只测试 Horizontal Initiative Control，不代表 Spatial Inertia v1 的 Down / Contact / Forced / Wall 等父级结构被废弃。

---

## Required reading

涉及 Momentum、Axis、Move、Steering、Ready、Reachability、Travel 时，必须按顺序读取：

1. 本文件；
2. ProjectC `docs/VAL-012-process-steering-ab.md`；
3. ProjectC `docs/VAL-012-actor-loop-v0-program-handoff.md`；
4. ProjectC `docs/VAL-012-actor-loop-v0-prototype-plan.md`；
5. ProjectC `docs/VAL-012-spatial-inertia-rules-v1.md`；
6. 本仓库 `README.md`；
7. 当前相关 solver / tests。

冲突时：

```text
最新用户明确修正
> process-steering-ab // active Horizontal control scope
> spatial-inertia-v1 // parent spatial rules
> current handoff / prototype plan
> current runtime snapshot
> old tests / historical docs
```

旧 A regression 不得反向禁止 B；B 也不得为了实现方便破坏 A。

---

## Active experiment contract

### A. Reachable Shape

保留现有：

```text
M / Axis
→ legal landing cells
→ click landing
→ deterministic Cell path
```

A 是有效对照组，不因为 B 出现就删除。

### B. Process Steering

```text
M / Axis
→ persistent motion state
→ player chooses Steering Intent
→ 1AT continuous response
→ derive trajectory / Cell crossings / landing
```

第一轮最低契约：

```text
M0 NoAxis + Move
→ active Move1
→ M0 Axis

M0 Axis + compatible Move
→ active Move1
→ Generate M1

M1+
→ persistent horizontal motion
```

Ready：

```text
Action complete → Ready
Ready != stopped motion
```

禁止恢复：

```text
M<=某阈值才允许输入
```

Action 内 Cell Crossing 不创建 input window。

---

## B Steering UI

```text
Yellow Arrow = Current Horizontal Axis
Blue Arrow = Steering Intent
```

B 中点击 Cell 只取：

```text
normalize(actor -> cell)
```

该 Cell 不是 Destination。

必须同时展示：

```text
Coast Projection
Controlled Projection
```

Preview / Commit 共用同一个 B resolver。

---

## B Steering rule

第一轮：

```text
Basic Steer max angular authority
= 60° / complete Action
```

不是：

```text
60° / Cell
```

Axis 应在整个 Action Duration 内朝 Blue 持续响应，不在 Action start 瞬间切最终方向。

内部 solver sample 数属于精度 / trajectory sampling，不是玩家可见 tick。

### M0

M0 无 Horizontal Momentum 方向抗性，可以自由建立 / 改写 Axis。

### Zero-M settlement

如果 action-end Passive Dissipation 后：

```text
M → 0
Yellow != Blue
```

允许再朝 Blue：

```text
<=60° Axis settlement
no extra Travel
```

用于保证低 M 灵活性。

---

## B Travel / Dissipation

目标 Band：

```text
M0 active Move = 1 Cell / AT
M1 ≈ 1 Cell / AT
M2 ≈ 2 Cells / AT
M3 ≈ 3 Cells / AT
```

B 的 trajectory / Cell Crossing 从 Action 内运动过程求出，不使用 A 的 authored Reachable Envelope 作为结果来源。

第一轮：

```text
unsustained Action end
→ Passive Dissipation -1M
```

语义：

```text
Move / Steer
→ active steering
→ no automatic sustain

Skip / Coast
→ no steering
→ no sustain

Drive / Build effect
→ later sustain / build hook
```

实现必须预留：

```text
baseDissipationPerAction
terrainDissipationModifier
sustainModifier
```

Normal baseline=1。

Ice 值当前不冻结：

```text
Normal1 / Ice0
vs
Normal2 / Ice1
```

不要为了 B 第一轮自行选定最终 Ice 模型。

---

## Dynamic labels

不新增独立 Coast Action。

```text
M0:
Move / Wait

Horizontal M>0:
Steer / Coast
```

底层 action id 可以继续共享；UI 文案负责表达状态语义。

---

## Down / parent spatial rules

Down Axis 保留：

```text
Horizontal Axis + M
= persistent planar motion

Down Axis + M
= grounded / stability commitment
```

本轮不删除或重新发明：

```text
Down M 1:1 cancel Incoming Horizontal M
```

ContactBehavior、Forced Use、M4、Wall 等详细父级规则仍读 `VAL-012-spatial-inertia-rules-v1.md`。

但它们不是第一轮 Process Steering A/B 的实现 Gate。

---

## Frozen-speed presentation

B 的 Ready 不能被表现成普通停车。

即使圆形 Actor 也至少测试：

- Yellow Axis；
- M dots；
- Coast Projection；
- previous motion trail / ghost samples；
- 高 M 更强的 arrow / trail / stretch；
- Blue Steering + Controlled Projection。

目标：世界暂停时看起来像“高速摄影冻结的一帧”。

---

## Implementation order

当前优先顺序：

```text
1. controlModel A/B selector
2. keep A regression
3. B startup / persistent motion
4. Yellow / Blue steering input
5. Coast + Controlled projection
6. 60° / Action response
7. zero-M settlement
8. Passive Dissipation / Resistance hook
9. frozen-speed visual test
10. browser playtest data
```

暂缓：

- 大范围 Strike / Pierce / Chain 重构；
- M4 完整 UI；
- Ice 最终数值；
- Attack / Drive / Brake 最终卡牌语义；
- enemy full trajectory UI。

需要高 M 时使用 debug preset，不要为了 B 先重做全部牌。

---

## Regression gates

至少：

```text
pnpm test
pnpm build
pnpm verify:dist
pnpm verify:browser
```

A 必须继续保护其现有核心操作。

B 至少覆盖：

1. M0 NoAxis Move → M0 Axis / Move1；
2. M0 Axis compatible Move → Generate M1；
3. M1/M2/M3 Coast；
4. M1/M2/M3 same-axis Steer；
5. 60° / large-angle Steering；
6. max 60° / Action independent of Cell count；
7. M1→M0 zero-M settlement no extra Travel；
8. Coast / Controlled Preview == Commit；
9. stopping distance from M3 without Sustain；
10. A/B switch does not contaminate each other's test expectations。

---

## Completion report

完成 A/B 第一轮后必须说明：

- 修改文件；
- A 是否保持；
- B solver / preview 入口；
- 实际 M1/M2/M3 travel；
- Steering response 与 zero-M settlement；
- M3 stopping distance；
- Resistance baseline；
- unit/build/browser/Pages verification；
- 哪些 parent Spatial rules 尚未接 B。

不要把 Process Steering 已实现写成“已经胜出”或 `validated`；胜负必须由试玩决定。
