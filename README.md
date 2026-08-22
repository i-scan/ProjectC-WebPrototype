# ProjectC Web Prototype · Inertia A/B Lab

本仓库用于验证 ProjectC 当前的 **Basic Move / Impulse + Aim → Inertia Motion** 核心驾驶体验。

2026-08-22 完成运行时重建；随后恢复了成熟版界面、热力摆与 Discrete / Hybrid A/B。旧 UT5/UT6/UT7 playground、Reachable Field endpoint selection、Target-cell navigation 与 segmented playback 仍只保留在历史备份中。

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
V_after = clamp(V_before + ΔV_aim)
```

- Drive: `|ΔV| = 0.85`
- Heavy Drive: `|ΔV| = 1.35`
- Drive 类冲量允许任意 Aim 方向，不做“当前朝向 ±N°”的预先合法性检查；转弯结果由向量合成自然产生。
- Counter Impulse 仍保留反向动作自己的语义检查。

### Hybrid

Hybrid 的权威状态是连续 `Position(x,z) + Velocity(x,z)`。当冲量改变运动方向时，120 个固定求解采样会从旧 Velocity 切线连续弯向新的合成 Velocity 切线，因此预览与实际播放都能呈现连续转向曲线；这不是 renderer 事后拟合 Cell waypoint。

### Discrete

Discrete 与 Hybrid 共用同一个 Aim、动作规则、棋盘与固定 1 AT 时钟，但把空间结果呈现为 Cell-centered movement，用于直接比较棋盘化与连续化的驾驶手感。

## 固定约束

- 点击 Aim Cell 立即执行，不存在 Apply / Confirm；
- 1 AT 固定 120 simulation substeps；
- 1 AT 固定 800ms 视觉播放；
- 正式逻辑状态只在视觉播放结束时提交；
- Hybrid 不吸附 Cell center；
- collision 不寻路绕障碍，而是按运动向量产生碰撞响应；
- 黄色 Axis 箭头只表示方向，使用固定长度；M1/M2/M3 大小只由角色上方三颗点表示。

## 当前页面

- 顶栏：版本信息 + Inertia / Thermal / Graphics 测试空间入口；
- 左栏：Actor 状态、热力摆、预测结果；
- 中栏：同一个 Three.js Hex6 棋盘、Discrete / Hybrid、Basic Move + Momentum Cards；
- 右栏：A/B 解释、Cell Inspector、World Layers、Quick Momentum、Collision / Board 调试。

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
- Axis 箭头固定长度，只表达方向；
- Basic Move 把远处 Cell 仅当作 Aim direction，而不是 destination；
- Drive 在已有速度下允许大角度 Aim，并按 `V + ΔV` 转向；
- Hybrid 同一转向输入得到非共线连续曲线；
- 所有动作在 800ms 播放完成前都不会提前提交逻辑位置。

## 在线入口

- Stable Pages: https://i-scan.github.io/ProjectC-WebPrototype/
- Build info: https://i-scan.github.io/ProjectC-WebPrototype/build-info.json
