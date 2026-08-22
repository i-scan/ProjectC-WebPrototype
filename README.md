# ProjectC Web Prototype · Inertia A/B Lab

本仓库用于验证 ProjectC 当前的 **Basic Move / Impulse + Aim → Inertia Motion** 核心驾驶体验。

2026-08-22 完成运行时重建；随后恢复成熟版界面、热力摆与 Discrete / Hybrid A/B，并持续围绕驾驶感、空间反馈和统一 AT 时间轴迭代。旧 UT5/UT6/UT7 playground、Reachable Field endpoint selection、Target-cell navigation 与 segmented playback 仍只保留在历史备份中。

## 当前输入与运动模型

Aim Cell 只定义方向，不是玩家要求到达的终点。

### Basic Move

```text
Basic Move + Aim direction
+ current inertia
→ 1 AT movement
```

当前验证解释：基础自主移动量为 1 Cell-equivalent / AT；它与当前惯性叠加，但 **不会自动增加、消耗或清空 Momentum / Velocity**。因此 M0 使用 Basic Move 会移动但仍保持 M0。

### Drive / Heavy Drive

```text
AimDirection = normalize(AimCellCenter - continuous Position)
V_after = clampLength(V_before + AimDirection × Force, MaxSpeed)
```

- Drive: `Force = 0.85`
- Heavy Drive: `Force = 1.35`
- Drive 类冲量允许任意 Aim 方向，不做“当前朝向 ±N°”的预先合法性检查；转弯结果由向量合成自然产生。
- Counter Impulse 仍保留反向动作自己的语义检查。
- Hybrid 曲线只负责空间形状，不能改变上述合向量结果；曲线 handle 已限制长度，collision 反射的也是物理 Velocity，而不是 Hermite 几何导数。

### Hybrid

Hybrid 的权威状态是连续 `Position(x,z) + Velocity(x,z)`。当冲量改变运动方向时，120 个固定求解采样会从旧 Velocity 方向连续弯向新的合成 Velocity 方向，因此预览与实际播放共享同一条连续转向曲线；这不是 renderer 事后拟合 Cell waypoint。

### Discrete

Discrete 与 Hybrid 共用同一个 Aim、动作规则、棋盘和 1 AT 逻辑时钟，但把空间结果呈现为 Cell-centered movement，用于直接比较棋盘化与连续化的驾驶手感。

## AT 与 Thermal 时间轴

逻辑时间与真实播放秒数分离：

- 每个动作恒定消耗 `1 AT`；
- solver 恒定 `120 simulation substeps / AT`；
- 默认播放速度为 `800ms / AT`；
- 页面 Timebase 滑杆可在 `250–1600ms / AT` 之间调整，50ms 一档；
- 调整只影响视觉播放速度，不改变任何求解结果；
- 正式逻辑 Position / Velocity / Thermal 仍只在该 1 AT 播放结束后提交。

热力摆与移动共用同一 AT 时间轴：

- 一个完整 Thermal cycle = `8 AT`；
- 一次 half swing = `4 AT`；
- 默认 800ms/AT 时，一个完整周期对应 6.4 秒真实时间；
- 移动播放的 1 AT 内，热力摆会按当前 fractional AT 连续更新，而不是动作结束后整步跳变。

## 棋盘反馈

- 黄色 Axis 箭头只表达当前 Velocity 方向，使用短、粗、固定长度的视觉符号；
- M1 / M2 / M3 大小只由角色上方三颗点表达；
- 预测线只显示前方约 1.55 world units 的即时趋势，不再标整条路径；
- 预测线是较粗的虚线，并直接沿 solver sample 形成弯曲趋势；
- 运动播放期间锁定 camera zoom 与 Three.js viewport resize，避免棋盘产生轻微的呼吸式缩放；
- 当前 terrain / weather / thermal palette 使用更低饱和、更明亮的 pastel 方向，保持规则颜色差异但弱化沉重感。

## 当前页面

- 顶栏：版本信息 + Inertia / Thermal / Graphics 测试空间入口；
- 左栏：Actor 状态、连续热力摆、预测结果；
- 中栏：同一个 Three.js Hex6 棋盘、Discrete / Hybrid、Basic Move + Momentum Cards；
- 右栏：A/B 解释、Cell Inspector、World Layers、Quick Momentum、Timebase、Collision / Board 调试。

当前动作：

- Basic Move
- Drive
- Heavy Drive
- Counter Impulse
- Hard Turn
- Coast

## 历史备份

重建前完整快照：

`backup/pre-rebuild-2026-08-22`

旧 Hybrid 曲线表现可以作为视觉/交互参考，但不得重新引入 Reachable Field endpoint selection、旧 Cell-center Hybrid authority 或 segmented playback。

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

浏览器门禁会实际验证：

- Discrete / Hybrid 页面按钮可切换且共用同一棋盘；
- Axis 是短粗固定长度、只表达方向；
- Basic Move 把远处 Cell 仅当作 Aim direction，而不是 destination；
- Drive 在已有速度下允许大角度 Aim，并严格按 `V + normalize(Aim) × Force` 转向；
- Hybrid 曲线不会改变最终物理合向量；
- Timebase 改变真实播放时长但不改变运动结果；
- 热力摆在动作播放中连续推进，并与同一 fractional AT 对齐；
- 播放期间 camera zoom、viewport 与 canvas geometry 不发生变化；
- 正式逻辑状态在配置的 AT 播放时长完成前不会提前提交。

## 在线入口

- Stable Pages: https://i-scan.github.io/ProjectC-WebPrototype/
- Build info: https://i-scan.github.io/ProjectC-WebPrototype/build-info.json
