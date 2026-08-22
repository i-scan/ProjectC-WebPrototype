# ProjectC Web Prototype · Inertia A/B Lab

本仓库是 ProjectC 的可执行规则实验环境。当前主实验用于验证 `Axis + Momentum + AT + Thermal` 如何形成可学习、可预测的 Hex6 驾驶体验。

> 重要：2026-08-22 之后曾出现一次 Basic Move 语义倒退，把它错误实现为“自主位移 + 当前惯性”。该解释已经被用户后续明确否定。本仓库当前修复方向以“相邻 Aim + 规则约束 Cell path”为准。

## 当前 Basic Move 契约

```text
Basic Move = 1 AT
Aim Cell = 当前 Cell 的相邻 Hex
M0 = Range 1
M2+ = 首轮候选 Range 2（基础 Range +1）
已有 Horizontal M = 整个移动 AT 只做一次 M-1
```

`M-1` 是移动 AT 对已有 Momentum 的一次结算，不是为了 Range+1 再支付一次额外 Momentum，也绝不能按经过的 Cell 数重复扣除。

### M0

```text
M0 + adjacent Aim E
→ Move 1 Cell E
→ M0
→ +1 AT
```

### M2 顺势

```text
E M2 + adjacent Aim E
→ Range 2
→ path: E, E
→ M2 -> M1
→ +1 AT
```

### M2 转向

每经过 1 个 Cell-step，当前 Axis 最多朝 Aim 方向 Redirect 60°。

```text
oldAxis = 当前 Axis
newAxis = oldAxis 朝 Aim 最多 Redirect 60°
residualM = max(0, M - 1) // 每 AT 只算一次

residualM > 0:
  实际位移沿 oldAxis

residualM == 0:
  实际位移沿 newAxis

移动后 Current Axis = newAxis
```

例如：

```text
E M2 + adjacent Aim NW
step 1: Move E, Axis E -> NE
step 2: Move NE, Axis NE -> NW
AT end: M1 / Axis NW
```

因此 Basic Move 的 Aim 虽然只允许选择相邻格，但一个 AT 的实际路径可能因为 Momentum 跨越多个 Cell。玩家选择的是当下 steering intent，而不是远端终点。

## 180° 转向

直接 `E -> W` 180° Redirect 不允许。ProjectC 的候选规则要求等价的顺/逆时针 U-turn 路线由玩家选择，不能由系统静默决定。

当前 WebPrototype 尚未接入左右分支选择 UI，因此已有 Horizontal M 时，正后方相邻 Aim 暂时返回 invalid，并提示需要 left/right branch。该行为属于 `prototype-snapshot`，不是最终交互结论。

## Impulse actions

Basic Move 与冲量卡不是同一个输入模型。

Drive / Heavy Drive / Hard Turn 仍使用：

```text
V_after = clamp(V_before + normalize(Aim) * Force, MaxSpeed)
```

这些冲量动作允许远端 Aim Cell 仅用于定义方向。Counter 保留反向窗口；Coast 保留当前 Velocity。

Hybrid 模式可以用连续曲线表现冲量转向，但最终 Velocity 必须与上述向量合成一致。

## Discrete / Hybrid

两种模式共用同一个 board、AT 和 action input。

对 Basic Move：

- 逻辑 Cell path 必须一致；
- 最终 Cell / M / Axis 规则结果必须一致；
- 表现插值可以不同，但不得绕过逐 Cell 路径。

对 Impulse：

- Discrete 用 Cell-step 表现；
- Hybrid 保留连续 Position / Velocity 与曲线转向表现。

## Thermal / Timebase

- 逻辑时间统一使用 AT；
- 默认视觉播放 `1 AT = 800 ms`；
- Timebase 滑杆只改变播放速度，不改变 solver 结果；
- Thermal Pendulum 与 movement playback 共用 AT 进度；
- 页面切后台时 playback 会暂停，避免视觉时间与逻辑时间漂移。

## 当前 UI

`#hex-prototype` / 默认页面包含：

- Inertia Driving Lab；
- Hex6 Cell World；
- Discrete / Hybrid A/B；
- Basic Move + Momentum/Impulse actions；
- Axis HUD 与 M dots；
- Thermal Pendulum；
- Cell Inspector；
- Collision / restitution / board radius debug；
- 可调 real-time / AT；
- Undo / Reset。

`#thermal-lab` 与 `#graphics-lab` 当前保留独立入口。

## Debug API

浏览器验证使用：

```js
window.__PROJECTC_PROTOTYPE__.setAction('basic-move')
window.__PROJECTC_PROTOTYPE__.setVelocity(1.7, 0) // E M2 preset equivalent
window.__PROJECTC_PROTOTYPE__.fireAt(1, 0)       // adjacent E Aim
window.__PROJECTC_PROTOTYPE__.trajectory()
window.__PROJECTC_PROTOTYPE__.snapshot()
```

修正后的关键契约：

```js
setAction('basic-move')
fireAt(2, 0) // false: remote Basic Aim

setVelocity(1.7, 0)
fireAt(1, 0) // true: M2 Range2, then M1
```

## 回归验证

```bash
pnpm test
pnpm build
pnpm verify:dist
pnpm verify:browser
```

Movement gate 至少覆盖：

1. M0 adjacent Basic Move = Move1 / M0 / +1AT；
2. remote Basic Aim 被拒绝且不推进 AT；
3. E M2 + E Aim = Range2 / E,E / M1；
4. E M2 + NW Aim = E,NE path / M1；
5. 180° Aim 不静默选择转向分支；
6. Basic Move 在 Discrete / Hybrid 得到同一逻辑 Cell path；
7. Hybrid Drive 仍保持曲线表现与 `V + ΔV` 最终速度；
8. Thermal / AT playback 与 viewport 稳定性不回归。

## GitHub Pages

`main` push 会触发：

```text
unit tests
→ production build
→ dist verification
→ headless Chrome browser verification
→ Pages deploy
→ published commit verification
→ pages/verified-deployment status
```

只有以上链路全部成功，才可以认为网页端已经发布到对应 commit。

## 规则边界

本仓库是 prototype reference implementation，不自动把实验值冻结成正式平衡方案。尤其：

- `M2+ -> Range2` 当前是首轮候选；
- canonical M speed 只是当前 runtime 表示方式；
- 180° steering branch UI 尚未完成；
- Collision 对 Basic Move 的最终规则仍可能继续调整；
- ProjectC design / validation 与用户最新明确修正优先于历史实现。

如发现文档、测试与最新规则冲突，应先修正回归契约，而不是让旧测试把错误实现保护成“稳定功能”。
