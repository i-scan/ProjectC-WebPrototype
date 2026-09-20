# Gameplay Lab · Playback / Timeline P0

状态：implementation snapshot / candidate，2026-09-20。基于 `main@fcadd5af` 的 HM/DM 规则，不是完整 Encounter 规则晋升。

## 交互

- Move / Drive / Attack / Launch / Release：选动作 → 悬停合法目标预览 → 单击目标开始播放。
- Brace / Skip：点击卡牌直接开始播放。移除外部 Commit 按钮。
- 播放期间锁定动作、目标输入、实验参数、Undo / Reset；相机视角仍可查看。
- `Playback / AT` 为 0.20–3.00 秒，每档 0.025 秒，只改变表现时长。
- 结束才内部提交 Ready。HP、M、敌人意图和 Thermal 的画面读数按时间采样，不提前显示最终状态。

## 数据链

`Ready snapshot → GameplayATPlan → shared playback clock → Board3D + analytic Thermal samples → internal Final Commit`

`src/labs/gameplay/gameplay-at-plan.js` 输出：

- `samples` / `actorSamples`：带真实 `t` 的位置与离散状态记录；非均匀时间，不按数组下标估算时刻。
- `actorTrajectories`、`actorPlaybackWindows`、`playerPlaybackEnd`：兼容 Trajectory 的 Board3D contract；Gameplay 优先使用 timed samples，窗口是兼容元信息。
- `events[]`：Declare、Travel、MomentumTransaction、Encounter、AttackPayload、Collision、DownResistance、ForcedMotion、ThermalImpulse、DomainNaturalBuild、Ready 等；每个事件带局部 `t` 和全局 `worldAt`。
- `thermalSegments[]`：Shared Thermal Runtime 用 Thermal Clock Lab 的同一解析 solver 构建；中途 impulse 后重新起段，T 连续、V 跳变，不插值最终 T。
- `finalState`：唯一可提交的 Player / Enemy / Thermal / worldAt 结果。

Preview 与执行使用同一 plan builder；目标与输入未变化时直接复用已预览计划。计划冻结 Profile 和参数。Gameplay 与 Trajectory 共用 `src/sim/plan-playback.js` 的时钟封装；既有 Trajectory 曲线和规则不改。

当前演示时序（表现候选，不是正式技能平衡）：声明 0，运动起始 0.08，主动路线在 0.72 前完成；Brace / Launch 在 0.20、Release 在 0.28；Forced 路线至 0.94、占格收尾至 0.96，Ready 在 1。动作惯性交易只在第一次成功 Travel 发生；无成功 Travel 的被阻挡 Drive 不提前 Build。静止 Skip 沉降在 0.94。Attack 按方向保持意图，接触检查去重；Clash 仅挂钩，不发明伤害胜负。

敌人意图在 AT 开始时与玩家一起固定方向，不读取玩家 finalState 后再决定。它们的事件进入同一队列；接触读取当时的状态快照，被强制位移后取消原待执行轨迹。FX 只读取事件类型 / 时间 / 接触点，Collision 环、Attack 切线、Clash 交叉、Down 抵抗蓝盾、Forced 方向箭头可分别出现。

## P0.1 · Shared Playback Convergence

本轮性能修正不新增 Gameplay 专属播放器。Trajectory、Thermal Clock、Gameplay 统一以 `src/sim/plan-playback.js` 中的 frozen playback object + shared clock sample 为时间定义：

- `playbackClockSample()` 是 presentation time 的唯一换算，统一输出 elapsed / progress / remaining。
- Board3D 与 Encounter FX 每帧直接读取同一个 playback clock；Gameplay React 不再用 60FPS `setProgress()` 驱动世界或 Three.js。
- Gameplay 与 Trajectory 都只在 shared clock 的 Ready 边界提交一次 authoritative finalState。
- Gameplay 的顶部读数、Thermal Pendulum、Enemy/Timeline debug UI 仅以 10Hz 采样同一 plan；这只是显示降频，不改变 solver、事件时刻或 Board3D 60FPS playback。
- Thermal Clock Lab 保留自身 SVG RAF，因为它是 renderer；但其 progress 也改为读取同一个 `playbackProgress()`，不再自行定义时间公式。
- 因而 Lab 与 Gameplay 可以拥有不同 renderer，却不能拥有不同 AT 时间语义：Trajectory Plan、Thermal segment 与 GameplayATPlan 均由同一个 playback clock 采样。

这次收敛只解决执行/表现一致性与主线程负担，不改变 HM/DM、Encounter、Collision Heat、Domain Build 等规则候选。

## P0.2 · Thin Gameplay Integration

性能问题确认后，Gameplay 不再继续扩张独立执行层。本轮做减法：

- Gameplay hover 先生成 player-only spatial preview；完整 GameplayATPlan 延迟到指针稳定后生成并缓存，点击同一目标直接复用，避免每次 pointer hover 同步跑完整 Enemy / Encounter / Thermal 1AT。
- Gameplay 直接复用当前实际 Thermal Clock V3 的 `ThermalPendulum`，删除 Gameplay 内重复摆锤实现；Thermal Clock V3 本身也接入 shared `playbackProgress()`。
- GameplayATPlan 的 event payload 不再深拷贝整套 Encounter actor snapshot；时间状态只保留在 timed tracks。普通 Travel 不再为 occupant lookup clone 全体 Actor。
- Encounter FX 改为 geometry-only；去掉每个事件即时 Canvas → CanvasTexture → SpriteMaterial 上传，保留 Collision / Attack / Clash / DownResistance / ForcedMotion 的语义差异。
- Gameplay Board 暂停天气粒子展示；天气不是当前 Momentum × Thermal 验证必要变量。
- 修复关键 Three.js 重建 bug：Gameplay 不再在每次 React progress 刷新时传入新的 `obstacles={[]}` / empty reachable array。Board3D 的 scene effect 依赖数组引用；旧实现会在 Playback 期间反复 dispose 并重建整张 Hex board，正是普通动画滞后与 Encounter 时长卡顿的主要性能回归来源。空集合现改为稳定常量，Board3D 默认空数组也改为稳定引用。

目标是让 Gameplay 退回到“Shared Spatial / Shared Thermal + Encounter adapter”的薄集成，而不是继续把它演化成第三套独立 Lab runtime。本轮不改变 HM/DM、Thermal、Encounter 结算规则。

## 明确保留的边界

- 本轮为 P0 执行架构，不等于完整的 Encounter Framework。HM/DM、1:1 Launch / Release、M-T 因子与无退款候选继续保留。
- 同时争同一空 Cell 暂显式标记 `SimultaneousClaim`，两方停留；这是 P0 保守占格保护，不是已认可的 HM 胜负规则。完整对向抵消 / 多方 Settlement 留待下一轮。
- `forcedDisplace` 仍复用 v1 候选。完整连锁传递尚未接入；遇二次阻挡显式记 `DeferredEncounter` 并停住，不伪造后续击飞或命中特效。边界 / 终点耗散与热量按终点时刻记录。
- Attack 携带 HM 的持续 Motion、完整同步 Move/Attack 裁决、同刻多方事件批量合并仍需后续实现；当前不是完整战斗系统。
- 敌人 Thermal 事件可追踪，但未新增敌人独立 T/V solver；Cell 环境演化、天气传播、Deflect / Link 仍后置。
- Down side 的 Basic Move 仍暂不开放，需 Drive / Launch；这不是正式玩法定论。

## 验证与发布

`pnpm test`、`pnpm build`、`pnpm verify:dist`、`pnpm verify:browser`。

新增 `pnpm verify:gameplay` 使用真实 Chrome / Edge 指针操作，不调用捷径 Commit：检验 hover 不改世界、单击播放、AT 中途位置、画面与 Ready 状态隔离、精确 Preview/Commit、输入锁、单次提交、攻击 / 接触 / 击退时刻、Brace/Skip、Undo/Reset、浏览器无异常。

输出 `artifacts/gameplay-playback.json`、`gameplay-playback-mid.png`、`gameplay-encounter-mid.png`，PR 与 Pages workflow 自动上传。浏览器使用独立临时目录，结束自动关闭并删除该目录。

`build-info.json.gameplayTimeline = gameplay-at-plan-p0-candidate`；dist 与线上校验同时检查该值、完整 commit 和 bundle 标记。只有 Pages 发布与线上 commit 校验全部成功才报告线上已更新。
