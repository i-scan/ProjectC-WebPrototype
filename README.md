# ProjectC Web Prototype

用于验证 ProjectC 核心规则的网页实验原型。

当前目标不是制作完整游戏，而是快速验证：

- 回合与环境结算顺序
- 3 AP + 最多保留 1 AP
- Actor 与 Cell 热交换
- 双层棋盘中的温差生风、云移动与降雨
- 敌人公开意图
- 基础战斗与救援目标
- 首批测试卡牌

## 本地运行

需要 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run dev
```

## 规则定位

当前规则均为 v0 可配置假设，优先服务体验验证。经过验证的结论再同步回 `ProjectC/docs/design.md`。
