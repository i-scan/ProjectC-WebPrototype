# ProjectC Web Prototype Instructions

## Active scope

本仓库当前用于 ProjectC 的 Cell World / inertia 驾驶规则实验。它是可执行验证环境，不自动等同于最终正式游戏规则。

当前活动拓扑为 Hex6。`Inertia Driving Lab` 同时保留：

- Basic Move 的离散 Axis / Momentum 驾驶验证；
- Drive / Heavy Drive / Counter / Hard Turn 等连续 `Velocity + ΔV` 冲量实验；
- Discrete / Hybrid 表现 A/B；
- Thermal 与统一 AT 播放；
- Collision / Cell World / Axis HUD 的视觉验证。

不要把不同实验分支的语义混成一套规则。

---

## Required reading

涉及 Actor Loop、Basic Move、Momentum、Axis、AT、Thermal、路径或 steering 时，至少读取：

1. 本文件；
2. `README.md`；
3. `src/sim/solver.js` 与对应测试；
4. ProjectC 仓库 `docs/VAL-012-actor-loop-v0-program-handoff.md`；
5. ProjectC 当前 design / validation 中与该实验有关的最新条目。

若用户在对话中给出比仓库文档更新的明确修正，以最新用户修正为准，并同步仓库文档与回归测试，禁止继续依赖旧实现自证正确。

---

## Basic Move authoritative correction

当前 Basic Move 不再使用以下旧解释：

```text
Voluntary Move 1 + Current Velocity
```

也不允许把远端 Cell 当作 Basic Move 的方向输入。

当前候选规则：

```text
Basic Move = 1 AT
Aim Cell = 必须与 Actor 当前 Cell 相邻
M0 = Range 1
M2+ = 首轮候选 Range 2（即基础 Range +1）
Horizontal M>0 的移动 AT = 整个 AT 只结算一次 M-1
```

这里的 `M-1` 是本移动 AT 对已有 Horizontal Momentum 的一次性结算，不是“支付额外 Momentum 才购买 Range+1”的第二笔成本。禁止按经过的每个 Cell 重复扣 M。

M2 直接示例：

```text
E M2 + Basic Move(E adjacent Aim)
→ Range 2
→ Cell path: E, E
→ 本 AT 结束 M2 -> M1
→ worldAt +1
```

M0 示例：

```text
M0 + Basic Move(E adjacent Aim)
→ Range 1
→ Move E 1 Cell
→ 仍为 M0
→ worldAt +1
```

---

## Basic Move steering / path

Aim Cell 是相邻 steering intent，不是远端目的地。

当已有 Horizontal Axis 时，每经过一个 Cell-step，Axis 最多朝 Aim 方向 Redirect 60°。

当前实现遵守：

```text
oldAxis = 当前 Axis
newAxis = oldAxis 朝 Aim 最多 Redirect 60°
residualM = max(0, M - 1) // 整个 AT 只算一次

if residualM > 0:
    Actual Move Direction = oldAxis
else:
    Actual Move Direction = newAxis

移动后：Current Axis = newAxis
```

因此 M2 的一个 2-Cell AT 可以产生受惯性约束的折线路径，而不能从起点直接 Tween 到一个任意远端目标。

示例：

```text
E M2 + Aim NW（Aim Cell 仍然只是起点相邻 NW）
→ step 1: 实际沿 E；Axis E -> NE
→ step 2: 实际沿 NE；Axis NE -> NW
→ 最终 M1 / Axis NW
```

Discrete 与 Hybrid 对 Basic Move 必须共享同一逻辑 Cell path；它们可以在视觉插值上不同，但不得得到不同的最终 Cell / M / Axis 规则结果。

---

## 180-degree steering

不允许直接 `E -> W` 180° Redirect。

ProjectC handoff 要求等价的顺/逆时针 U-turn 路线由玩家选择，而不是系统静默替玩家决定。

当前 WebPrototype 尚未完成左右分支选择 UI，因此当前临时行为是：

```text
已有 Horizontal M + 正后方相邻 Aim
→ plan invalid
→ 明确提示需要 left/right steering branch
```

这是 `prototype-snapshot`，不是最终确认的交互方案。后续实现左右分支时必须补充 UI 与浏览器回归测试。

---

## Impulse actions remain separate

不要因为修正 Basic Move 而破坏冲量卡实验。

Drive / Heavy Drive / Hard Turn 仍使用：

```text
V_after = clamp(V_before + normalize(Aim) * Force, MaxSpeed)
```

它们允许远端 Aim Cell 用来定义向量方向；这与 Basic Move 的“相邻 Aim”是两套不同输入契约。

Counter 保留专用反向窗口；Coast 保留当前 Velocity。

Hybrid 的曲线只负责呈现连续转向过程，最终 Velocity 必须仍与向量合成结果一致。

---

## State / presentation boundary

当前运行时仍以以下状态支持现有 A/B：

```text
Position(x,z) + Velocity(x,z) + worldAt
```

Momentum level 暂由速度区间映射到 M0~M3；Basic Move 结算后使用 canonical M speed 表示新的 M。

这只是当前 WebPrototype 的承载方式，不代表正式设计已经决定用连续 Velocity 保存所有 Axis / M 状态。

表现层不得自行修改规则结果：

- Three.js 只消费 solver samples / state；
- React 不重新计算另一套路径；
- Preview 与 click execution 必须调用同一 solver；
- Thermal 的真实时间播放不能改变 AT 逻辑结果。

---

## UI invariants

- Basic Move 只能提交相邻 Aim；远端 `fireAt` 必须返回 false。
- Basic Move 跨多 Cell 时按 solver 输出的 Cell path 播放，不得直接按远端目标直线插值。
- Axis HUD 与 Momentum dots 必须反映结算后的 M / 方向。
- `Undo`、`Reset`、Timebase、Thermal Pendulum 在 playback 期间继续保持原有稳定性。
- 不重新加入独立 `Apply` 按钮；当前交互仍为 click-to-resolve。

如果 UI 文案与 solver 冲突，以 solver + 当前 validation 为故障信号，必须同步修正文案，不能用文案覆盖规则。

---

## Regression gates

影响 movement 的提交至少验证：

```text
pnpm test
pnpm build
pnpm verify:dist
pnpm verify:browser
```

Basic Move 的必测用例：

1. M0 + adjacent Aim -> Move1 / M0 / +1AT；
2. remote Basic Aim -> invalid，且不改变 worldAt；
3. E M2 + E adjacent Aim -> Range2 / E,E / M1 / +1AT；
4. E M2 + NW adjacent Aim -> E,NE path / M1；
5. direct opposite Aim 不得静默选 U-turn 分支；
6. Discrete / Hybrid Basic Move 最终逻辑路径一致；
7. Hybrid Drive 的 `V + ΔV` 与曲线表现不得回归。

Pages 发布只有在 build、browser verification、deploy 和 published-commit verification 全部成功后才算完成。

---

## Documentation discipline

禁止再次写入或恢复这些已否定表述：

- “Basic Move = voluntary displacement + current inertia”；
- “Basic Move 可以用远端 Cell 只定义方向”；
- “Basic Move 永远 ΔM 0 / Momentum persistent”；
- “多 Cell Basic Move 可以绕过 Cell path 直接做连续终点插值”。

如果未来用户再次修改规则，先更新本文件与回归契约，再改实现，避免旧测试把错误行为保护成“稳定功能”。

---

## Completion report

完成 movement 任务后回复必须说明：

- 修改文件；
- Basic Move / Impulse 哪些玩法行为发生变化；
- 哪些仍是 `prototype-snapshot`；
- 单元测试 / build / browser gate 结果；
- Pages 是否部署并验证到具体 commit；
- 是否需要回写 ProjectC validation / design 文档。
