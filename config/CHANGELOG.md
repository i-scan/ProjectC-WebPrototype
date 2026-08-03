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

## UI Prototype / Ruleset 0.1.0 — 2026-08-03

### 类型

VAL-012 Actor Heat 信息表达迭代；**无玩法行为变化**。

### 修改

- 在热力钟摆色温刻度下方增加弧形 Drift 向量；
- 当前原型直接复用既有动量 `momentum` 作为 Drift 数据源，不增加独立状态或测试滑杆；
- Drift 正值使用暖色向热侧展开，负值使用冷色向冷侧展开；
- Drift 长度表达动量绝对值，`1` 动量对应一个温度格的角宽 `12°`，显示长度在 `±3` 封顶；
- Drift 为 `0` 时，以 Set Point 正下方的灰点表示静止；
- 移除标题右侧原有“向热 / 向冷 / 静止”文字和小箭头，保留“热力钟摆”标题与折叠参数测试区；
- Drift 弧、摆锤和色温刻度继续共用同一套 SVG 极坐标方向，避免镜像映射。

### 当前边界

- `momentum` 与 Drift 暂时视为同一 UI 测试量；
- Drift 只表达方向与强度，不改变下一回合体温；
- Drift 不参与衰减、反转、推动、制动、释放或环境换热；
- 参数测试区仍使用现有“动量”滑杆，不增加重复的 Drift 控件；
- Square4 不增加对应功能。

### 验证

- [x] 正动量映射到暖色向热弧；
- [x] 负动量映射到冷色向冷弧；
- [x] 零动量映射到灰点；
- [x] 弧长按动量绝对值线性增长，并在 `±3` 封顶；
- [x] Drift 与 Set Point 改动相互独立，始终从物理最低点展开；
- [ ] 实际浏览器中的箭头尺寸、弧线间距与窄侧栏可读性；
- [ ] Drift 是否应在正式规则中与内部 momentum 拆分。

对应 Validation：`VAL-012`。

---

## UI Prototype / Ruleset 0.1.0 — 2026-08-02

### 类型

VAL-012 Actor Heat 信息表达验证；**无玩法行为变化**。

### 新增

- 在 Hex6 左侧 `Tactical Actor` 的 HP 与体温下方增加热力钟摆；
- 摆锤位置显示当前体温 `T`；
- 摆锤最低点显示可变 Thermal Set Point `S`，默认值为 `+1`；
- 仪表盘显示 `-3 ～ +3` 离散色温区和两侧极限区；
- 常驻显示摆动方向和精确动量读数；
- 增加折叠式 UI 参数测试区，可独立调整体温、Set Point 和动量；
- 增加摆锤角度、方向、色区和格式化的 Vitest 回归测试。

### 当前边界

- 当前动量只用于 UI 方向与读数测试；
- 角色体温发生离散变化时，以最近一次变化量更新显示动量；
- 动量不改变下一回合体温，不参与推动、制动、释放或环境交换；
- 阶段名称、温区收益、额外阈值和极限区规则均未锁定；
- Square4 不增加对应功能。

### 原因

在继续设计跨回合惯性和释放规则前，需要先验证玩家能否读懂“最低点是角色自身 Set Point，而不是固定 0”，以及方向、位置、色区和精确动量是否构成有效而不过载的信息组合。

### 验证

- [x] 默认温血 Set Point `+1` 映射到摆锤最低位置；
- [x] 冷热极限映射到相反两侧；
- [x] 动量符号映射到冷侧、静止和热侧；
- [x] UI 参数测试入口；
- [ ] 实际浏览器布局与窄侧栏可读性；
- [ ] 玩家是否需要常驻精确动量；
- [ ] Set Point 改变后，绝对温区与相对偏离是否同时清楚；
- [ ] 跨回合惯性规则。

对应 Validation：`VAL-012`。

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