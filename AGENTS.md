# ProjectC Web Prototype Instructions

## Active scope

本仓库是 ProjectC 的可执行规则实验环境。

2026-09-07 起，当前最高优先级切换为：

```text
VAL-012 Thermal Clock Lab v0
→ Program05 isolated Thermal Dynamics implementation
→ coefficient / environment / card tuning
→ adiabatic Thermal Clock test
```

Spatial Momentum / Horizontal Control 暂时保留当前版本，不继续优先扩张运动学规则。

现有：

```text
Inertia Driving Lab · A
Trajectory Lab · B
```

必须保持可用，Thermal 实验不得破坏它们。

---

## Required reading — Thermal tasks

涉及 Thermal Clock、Temperature、Drift、Set Point、Environment、Thermal Card、AT 时，按顺序读取：

1. 本文件；
2. ProjectC `docs/VAL-012-thermal-clock-lab-v0.md`；
3. ProjectC `docs/VAL-012-thermal-clock-lab-program05-handoff.md`；
4. ProjectC `docs/VAL-012-thermal-pendulum-ui-prototype-plan.md`；
5. ProjectC `docs/VAL-012-unified-time-system-program-handoff.md` 中 AT / Thermal 时序；
6. 本仓库 `README.md`；
7. 当前 `src/sim/thermal.js`，仅作为历史实现参考；
8. Inertia / Trajectory Lab 当前布局与导航代码。

冲突时：

```text
最新用户明确修正
> thermal-clock-lab-v0
> program05 handoff
> older Thermal docs
> current shared thermal.js snapshot
```

---

## Thermal model candidate

状态：

```text
T = Temperature
V = Thermal Drift = dT/dt
S = Set Point
```

候选连续模型：

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

`cEnvGain` 是实验参数，不是正式冻结规则。

---

## Set Point

```text
S = Actor 长期热平衡基准
```

普通 Tactical Environment 不直接改写 S。

Thermal Lab 中允许 Slider 修改 S，只是：

```text
Debug / Build Proxy
```

不得把它实现成正式战斗中免费的即时能力。

---

## Solver requirement

本轮必须使用可查询任意时刻的连续解析 / 精确 segment solver。

禁止只定义：

```text
Ready n → T_next/V_next → Ready n+1
```

再用：

```text
lerp(start,end)
```

冒充 AT 内 Thermal trajectory。

必须支持：

```text
sample at arbitrary t
piecewise parameter change
mid-segment impulse
underdamped
near-critical
overdamped
```

Preview / Commit 使用同一 solver。

---

## Implementation isolation

第一轮优先建立：

```text
src/labs/thermal/
```

例如：

```text
ThermalClockLab.jsx
thermal-clock-model.js
thermal-clock-model.test.js
```

不要直接把 candidate 覆盖成 shared：

```text
src/sim/thermal.js
```

的唯一正式实现。

旧 shared thermal.js 仅供解析振子结构参考。

---

## AT contract

```text
AT = Global World Time unit
```

不是 Thermal discrete tick。

第一轮卡牌全部 1AT。

```text
Preview
→ no worldAt advance

Commit
→ worldAt +1AT
```

AT0：

- 不推进自然 T / V 演化；
- 不推进持续环境交换；
- 可发生明确的即时 Drift impulse。

---

## Adiabatic / Thermal Clock Gate

```text
Adiabatic = kE == 0
```

左侧必须显示：

```text
+1AT
+2AT
+3AT
+4AT
```

等 future ghost，来自真实 solver。

目标是验证：

> 当 Actor 已有非零 Thermal state 时，Pendulum phase 是否可以承担 Thermal Clock / AT 计时与预测作用。

`T=S,V=0` 时保持静止是正确行为，不得为了钟表效果强制自振。

---

## Test cards

全部 1AT：

```text
Heat I    +0.4 Drift
Heat II   +0.8
Heat III  +1.6

Cool I    -0.4
Cool II   -0.8
Cool III  -1.6

Skip       0
```

Small / Medium / Large impulse 必须可调。

Cold 默认镜像 Hot。

卡牌只改 Drift impulse，不直接改：

```text
T
S
M
```

---

## Thermal Clock Lab layout

参考现有 Inertia Driving Lab 三栏布局。

### Left

```text
Thermal Pendulum
Current T
Current V
Set Point S
Hotward / Coldward
future AT ghosts
```

T / V / S Debug input 可以与 Pendulum 放同组。

### Center

中上保留：

```text
Reserved Board / Future Trajectory Integration
```

不要为了填空添加临时棋盘规则。

中下：

```text
Heat I / II / III
Cool I / II / III
Skip
Selected Action
Predicted next Ready T/V
Commit
```

### Right

```text
Environment
Dynamics
Diagnostics
Preview / Playback
Presets / Reset
```

至少可调：

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
Regime
Adiabatic yes/no
```

underdamped 时显示：

```text
Damped Period
Amplitude decay
```

若可求，再显示：

```text
Next Apex
Next Set Point crossing
```

---

## Environment presets

第一轮建议：

```text
Adiabatic
Mild Cold
Strong Cold
Mild Hot
Strong Hot
```

Preset 只给 prototype 参数，不是正式 Weather 规则。

---

## Thermal regression gates

至少自动测试：

1. `T=S,V=0,kE=0` Skip 后静止；
2. impulse 只瞬时改变 V；
3. Preview final == Commit final；
4. arbitrary sample end == segment final；
5. under/critical/over 都有限且无 NaN；
6. kE=0 时 Tenv 不影响结果；
7. 同参数一段 solve == 分两段 solve；
8. 中途 impulse piecewise 可复现；
9. Hot / Cold 对称响应；
10. Preview 不推进 worldAt。

仓库级仍需：

```text
pnpm test
pnpm build
pnpm verify:dist
pnpm verify:browser
```

---

## Spatial tasks

如果任务明确回到 Momentum / Axis / Trajectory，则继续读取：

```text
ProjectC/docs/VAL-012-process-steering-ab.md
ProjectC/docs/VAL-012-spatial-inertia-rules-v1.md
```

当前不要因为 Thermal 工作顺便重写 Spatial 控制规则。

---

## Completion report

程序05第一轮完成后必须说明：

- 新增 / 修改文件；
- lab-local solver 位置；
- under / critical / over 支持情况；
- 当前默认参数；
- 绝热 Thermal Clock ghosts；
- 7 张测试卡；
- Environment presets；
- Preview == Commit；
- unit/build/browser/Pages 状态；
- 最明显的参数问题；
- `cEnvGain` 是否看起来有必要；
- shared Thermal runtime 尚未合并的内容。

不得把 candidate lab 实现宣称为 validated final Thermal model。
