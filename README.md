# ProjectC Web Prototype · Thermal Clock Lab

本仓库是 ProjectC 的可执行规则实验环境。

当前最高优先级：

```text
VAL-012 Thermal Clock Lab v0
→ Program05 isolated Thermal Dynamics implementation
→ coefficient / environment / card tuning
→ adiabatic Thermal Clock test
```

当前 Thermal 主实验规范：

```text
ProjectC/docs/VAL-012-thermal-clock-lab-v0.md
```

程序05交接：

```text
ProjectC/docs/VAL-012-thermal-clock-lab-program05-handoff.md
```

Spatial Momentum / Horizontal Control 暂时保留当前版本；Inertia Driving Lab 与 Trajectory Lab 继续作为已有实验资产，不在本轮重写。

---

## Thermal Clock Lab 目标

验证一个连续 Thermal Inertia 候选是否能同时提供：

- `Temperature T`；
- `Thermal Drift V`；
- 固定于 Tactical 内的 `Set Point S`；
- Action / Event Drift impulse；
- Environment coupling；
- Overshoot；
- 任意 AT 内时刻的精确状态；
- 绝热情况下可读的 Pendulum phase / Thermal Clock。

本轮不先接：

```text
Spatial M cap
Hand hot/cold lifecycle
Cell material phase change
Weather propagation
Enemy Thermal state
```

---

## Candidate model

```text
T' = V

V' =
  - cEff*V
  + kS(S-T)
  + kE(Tenv-T)

cEff = cBase + cEnvGain*kE
```

Action / Event：

```text
V(t+) = V(t-) + impulse
```

其中 `cEnvGain` 明确是实验参数。

---

## Set Point

```text
S = Actor 长期热平衡基准
```

环境不在普通 Tactical 中即时改写 S。

Lab 左侧开放 S Slider，只作为 Debug / Build Proxy，方便比较不同角色 / 构筑中心。

---

## Continuous solver / AT

```text
AT = Global World Time unit
```

不是 Thermal discrete update tick。

本轮 solver 必须能准确查询：

```text
T(t)
V(t)
```

在任意 `t`。

Preview / Playback / Commit 共享同一解析 / piecewise solver。

禁止只在 Ready 算终点再 `lerp` Pendulum，因为那会丢失：

- Apex；
- reverse；
- crossing；
- AT 中途事件。

---

## Adiabatic Thermal Clock

```text
Adiabatic = kE == 0
```

当 Actor 已有：

```text
T != S
or
V != 0
```

左侧显示真实 solver 预测的：

```text
+1AT
+2AT
+3AT
+4AT
...
```

future ghosts。

这项实验专门验证 Pendulum 是否能承担 Thermal Clock 的 phase / AT 计时作用。

`T=S,V=0` 时保持静止是正确行为，不强制永动。

---

## Cards

第一轮全部 1AT：

```text
Heat I    +0.4 Drift
Heat II   +0.8
Heat III  +1.6

Cool I    -0.4
Cool II   -0.8
Cool III  -1.6

Skip       0
```

Small / Medium / Large impulse 可调。

交互：

```text
select
→ preview
→ Commit
```

Preview 不推进 worldAt；Commit 推进 1AT。

---

## Layout

参考 Inertia Driving Lab 三栏结构，方便以后直接与 Trajectory Lab board 合并。

### Left

```text
Thermal Pendulum
Current T / V / S
Hotward / Coldward
AT future ghosts
```

### Center

中上：

```text
Reserved Board / Future Trajectory Integration
```

暂时保持空白。

中下：

```text
Heat I/II/III
Cool I/II/III
Skip
Preview / Commit
```

### Right

```text
Environment
Dynamics coefficients
Diagnostics
Presets
Playback / Reset
```

至少暴露：

```text
Tenv
kE
kS
cBase
cEnvGain
Clamp
Preview Horizon
Playback Speed
```

---

## Diagnostics

至少显示：

```text
K = kS+kE
Teq
cEff
D = cEff^2 - 4K
Regime = Under / Critical / Over
Adiabatic
```

underdamped 时额外显示：

```text
Damped Period
Amplitude decay
```

有可靠求解时显示：

```text
Next Apex
Next Set Point crossing
```

---

## Initial candidate values

仅用于页面初始可观察，不是冻结值：

```text
S = +1
T = +1
V = 0

kS = 0.25
cBase = 0.25
Tenv = +1
kE = 0
cEnvGain = 1.0
```

Environment quick presets：

```text
Adiabatic
Mild Cold
Strong Cold
Mild Hot
Strong Hot
```

所有值仍可手调。

---

## Implementation isolation

第一轮建议：

```text
src/labs/thermal/ThermalClockLab.jsx
src/labs/thermal/thermal-clock-model.js
src/labs/thermal/thermal-clock-model.test.js
```

当前：

```text
src/sim/thermal.js
```

只作为历史解析振子参考，不直接被 candidate Lab 覆盖成正式 runtime。

方案确认后再决定合并。

---

## Required regression

```bash
pnpm test
pnpm build
pnpm verify:dist
pnpm verify:browser
```

Thermal 最少测试：

1. `T=S,V=0,kE=0` Skip 静止；
2. impulse 只瞬时改变 V；
3. Preview final == Commit final；
4. arbitrary sample end == segment final；
5. under / critical / over 不 NaN；
6. kE=0 时 Tenv 无效；
7. 相同参数一段 solve == 两段 solve；
8. mid-segment impulse 可复现；
9. Hot / Cold 对称；
10. Preview 不推进 worldAt。

Pages 仍只有 unit / build / dist / real Chrome / deploy / published commit verification 全通过后才算发布完成。

---

## Existing Spatial Labs

```text
Inertia Driving Lab · A
Trajectory Lab · B
```

继续保留，不因 Thermal 当前优先级而删除。

若重新处理 Spatial，仍以 ProjectC：

```text
docs/VAL-012-process-steering-ab.md
docs/VAL-012-spatial-inertia-rules-v1.md
```

为对应设计依据。
