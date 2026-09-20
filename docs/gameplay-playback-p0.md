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
