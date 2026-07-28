# Core Rules Config Changelog

本文件记录 WebPrototype 中每一次影响玩法结果的机制、数值、地图和时序变化，最新记录在前。

每次记录至少包含：

- ruleset / schema 版本与日期；
- 对应 validation ID；
- 修改字段；
- 旧值与新值；
- 修改原因与预期影响；
- 验证状态和结果；
- 对应提交或 PR。

---

## Schema 0.2.0 / Ruleset 0.1.0 — 2026-07-28

### 类型

文档权威与元数据校正；**无玩法行为变化**。

### 修改

- `schemaVersion`：`0.1.0 → 0.2.0`；
- 顶层 `status`：`prototype_hypothesis → prototype-snapshot`；
- `designReference`：从已被替代的 `docs/core-loop-and-rules.md` 改为 `docs/design.md`；
- 新增 `rulesReference`，指向 `docs/core-rules-spec.md`；
- 新增 `validationReference`，指向 `docs/core-rules-validation.md`；
- 新增 `implementationCommit`，记录本配置镜像的原型实现基线；
- Schema 状态词与 ProjectC 的统一状态词对齐。

### 原因

ProjectC 已确立 Design Bible、规则基准、验证记录和 WebPrototype 配置的分工。旧引用和旧状态词会造成误读，因此在配置进入 `main` 前统一修正。

### 验证

- [x] 精确玩法字段保持 ruleset `0.1.0` 不变；
- [x] Card、Actor、Equipment、AP、温度、地图和环境数值未改变；
- [ ] Schema 与引用完整性校验；
- [ ] Vitest 漂移测试；
- [ ] 构建。

---

## Ruleset 0.1.0 / Schema 0.1.0 — 2026-07-28

### 类型

初始配置基线。

### 新增

- 建立 `core-rules.v0.json`，镜像当前原型中的 AP、牌堆、十张卡牌、Actor、装备、温度、环境、Room / World 与山体规则；
- 建立 JSON Schema；
- 建立配置引用与硬编码漂移测试；
- 明确配置属于网页原型运行权威，而不是正式版本规则；
- 明确每次机制或数值实验都必须记录在本文件中。

### 当前镜像值

- 基础 AP 3，最多保留 1；
- 每消耗 1 AP，entropy +1；
- 温度范围 -3 ～ +3，普通直接修改 -2 ～ +2；
- 十张测试卡与固定初始牌序；
- 手牌补至 5，当前无随机洗牌；
- Water / Ice、Grass / Fire、Water / Cloud；
- 温差生风、Cloud、Rain intent 与 Cell → Actor 热交换；
- Hex6 Room R2 ～ R7，默认 R4；
- Hex6 World 16 × 12；
- Travel 每累计移动 baseAP 格推进一次世界 tick；
- Mountain 阻挡移动、路径、推击和直线攻击，暂不影响 Sky 天气。

### 对运行的影响

无玩法变化。本版本把现有代码值登记为配置基线，并增加漂移检测；GameState 和 Card Library 暂时仍由现有代码构建。

### 验证状态

- [x] JSON 与 Schema 已建立；
- [x] Card ID、牌序、Equipment 引用和 mode 引用具有自动检查；
- [x] 配置与现有 Card Library / GameState / Hex profile 具有回归对照；
- [ ] GameState 直接从配置构建；
- [ ] Card Library 直接从配置构建；
- [ ] 完成 R4 / R5 / R6 试玩对照；
- [ ] 第一批规则晋升到 ProjectC `core-rules-spec.md`。

### 后续版本候选

- `0.2.0`：用配置生成 Card Library、Actor 默认值和 GameConfig；
- `0.3.0`：根据 R4 / R5 / R6 对照调整 Range、AP 或环境覆盖；
- `1.0.0`：核心循环、Session 与 Shelter 实验形成完整可验证闭环。
