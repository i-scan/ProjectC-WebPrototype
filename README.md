# ProjectC Web Prototype · Continuous Inertia Rebuild

本仓库用于验证 ProjectC 当前的 **Card + Aim → Impulse → Continuous Motion** 核心驾驶体验。

2026-08-22 起，主线完成结构性重建。旧 Square4、UT5/UT6/UT7、Reachability A/B、Target-cell navigation、Basic Move、旧 Discrete/Hybrid renderer 与 segmented playback 不再属于活跃运行时。

## 当前唯一玩法模型

```text
Card + Aim
→ Impulse
→ continuous Position + Velocity
→ fixed 1 AT deterministic simulation
→ collision / boundary response
→ final continuous Position + Velocity
→ derived Hex Cell / M / Heading
```

关键约束：

- Cell 是 Aim 与环境分区，不是玩家指定的终点；
- 点击合法 Cell 即完成瞄准并立即触发 1 AT，不存在 Apply 二次确认；
- 权威状态是连续 `Position + Velocity`；
- Hex Cell、Momentum M0~M3、Heading 都由连续状态派生；
- 1 AT 固定 120 simulation substeps；
- 1 AT 固定 800ms 视觉播放；距离越远意味着速度更快，而不是动画时间更长；
- 正式逻辑状态只在视觉播放结束时提交，禁止先跳终点再补播；
- 当前只验证 Drive / Heavy Drive / Counter / Hard Turn / Coast 与硬表面碰撞；
- Thermal、敌人行动、天气、完整卡组等在基础驾驶成立前不接回运行时。

## 页面结构

页面沿用当前实验习惯的三栏布局：

- 左：Actor 连续位置/速度、派生 M/Heading、输入规则与预测结果；
- 中：单一 Three.js Hex6 棋盘、Isometric/Top 相机、Motion Cards；
- 右：求解器固定参数、Quick Velocity、Collision、Board Radius 与验证范围。

不存在 Discrete / Hybrid gameplay switch，也不存在第二套棋盘 renderer。

## 历史归档

重建前主线完整快照：

`backup/pre-rebuild-2026-08-22`

所有旧工作分支独有历史统一锚定于：

`archive/all-legacy-2026-08-22`

旧工作分支名已统一收束到该 archive anchor，不再代表可继续开发的候选版本。

## 本地运行

Node.js 22 + pnpm 10：

```bash
pnpm install
pnpm dev
```

验证：

```bash
pnpm test
pnpm build
pnpm verify:dist
pnpm verify:browser
```

`verify:browser` 会在真实 Chrome 中验证：逻辑状态不会提前瞬移、视觉 Actor 在 1 AT 内连续移动、1 AT 播放时长固定、最终位置不吸附 Cell center、Coast 保留速度。

## 在线入口

- Stable Pages: https://i-scan.github.io/ProjectC-WebPrototype/
- Build info: https://i-scan.github.io/ProjectC-WebPrototype/build-info.json
