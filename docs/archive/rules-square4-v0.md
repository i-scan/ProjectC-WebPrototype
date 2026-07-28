# Square4 10×10 Rules Lab 历史快照

> 状态：`deprecated as current baseline`
>
> 本文件保存 2026-07-13 建立的最初 Square4 10×10 网页规则实验。它只用于历史追溯和可能的 A/B 回归，不代表当前 ProjectC 规则基准。
>
> 当前规则状态见 ProjectC `docs/core-rules-spec.md`；后续精确运行配置由 `agent/rules-config-baseline` 分支的 `config/` 管理。

---

## 当时的输入

- 棋盘：10 × 10，Ground 与 Sky 共用坐标；
- 基础 AP：3；上回合最多继承 1 AP，仅持续至下一回合；
- 玩家基础行动：移动、剑攻击、出牌；
- 玩家装备：剑、普通衣服、普通鞋；
- 敌人：灵活的追猎者、强壮的精英守卫；
- NPC：初始体温 -3，恢复到 0 后开始跟随玩家；
- Session：温暖 NPC、处理精英守卫、护送 NPC 返回 Shelter。

## 当时可切换的结算顺序

1. 玩家行动后局部反应 → 敌人行动后局部反应 → 一次全局环境；
2. 玩家 → 全局环境 → 敌人；
3. 玩家 → 全局环境 → 敌人 → 全局环境。

## 当时的环境规则

1. 普通卡牌只能把目标 Cell 温度修改到 -2～+2；结构支持 -3～+3；
2. Water 在 Ground 温度 ≤ -1 时变为 Ice；Ice 在温度 ≥ +1 时变回 Water；
3. Grass 在 Ground 温度达到 +2 且不为 Wet 时变为 Fire；
4. Water 在 Ground 温度达到 +1 且对应 Sky 为空时形成 Cloud；
5. Ground 与 Sky 温差达到 2 时，Sky 温度向 Ground 靠近 1；
6. 相邻 Sky 温差达到 2 时，从高温格向低温格生成风；
7. Cloud 沿风移动 1 格，持续两次全局阶段后生成 Rain intent；
8. Rain 在下一次全局环境阶段生效，提高湿度、熄灭 Fire、使 Ground 温度向 0 回落并消耗 Cloud；
9. Actor 在热交换阶段受到所在 Ground Cell 单向影响；
10. Actor 体温达到 -3 / +3 时受到 1 点环境伤害。

## 当时的十张测试卡

- 升温；
- 降温；
- 紧握；
- 热势斩；
- 冷锋；
- 推斩；
- 穿刺；
- 放血；
- 格挡；
- 回火。

## 历史价值

该版本建立了 3 AP + 保留 1、Ground / Sky、最小风云雨、追猎者、精英、失温 NPC、Shelter、十张卡和规则日志。

后续默认验证已经转向 Hex6、World / Room、Travel / Tactical 和 2D / 3D 解耦。本文件不得作为新增机制或数值的更新入口。
