from pathlib import Path

path = Path('src/hex/ActorLoopUt7BasicMovePlayground.tsx')
source = path.read_text()


def replace_once(old: str, new: str):
    global source
    if source.count(old) != 1:
        raise SystemExit(f'expected exactly one match, found {source.count(old)} for:\n{old[:180]}')
    source = source.replace(old, new, 1)

replace_once(
    "import { basicMovePlansForTarget, basicMoveTargetCoords } from './actorLoopUt7BasicMove'",
    "import { basicMoveNavigationPlan, basicMoveNavigationTargetCoords } from './actorLoopUt7Navigation'",
)

replace_once(
'''function MovePreview({ plan }: { plan?: ActionPlan }) {
  if (!plan?.valid || plan.timeline.length === 0) return null
  const trace = plan.timeline[0]
  return (
    <div className="ut7-route-inspector" data-ut7-route-steps={trace.cellSteps.length} data-ut7-move-preview>
      <header><strong>Move Resolution</strong><span>1 AT · {trace.cellSteps.length} Cell-step{trace.cellSteps.length === 1 ? '' : 's'}</span></header>
      <div className="ut7-route-rows">
        <div className={`behavior-${trace.behavior}`}>
          <b>AT1</b>
          <span>M{trace.beforeM}→M{trace.afterM}</span>
          <span>{axisLabel(trace.beforeAxis)}→{axisLabel(trace.afterAxis)}</span>
          <span>{trace.cellSteps.map((step) => `#${step.index} ${step.moveDirection} / ${axisLabel(step.newAxis)}`).join(' · ') || 'No displacement'}</span>
          <em>{trace.behavior} / {trace.thermalIntent}</em>
        </div>
      </div>
    </div>
  )
}''',
'''function MovePreview({ plan }: { plan?: ActionPlan }) {
  if (!plan?.valid || plan.timeline.length === 0) return null
  const cellStepCount = plan.timeline.reduce((sum, trace) => sum + trace.cellSteps.length, 0)
  return (
    <div className="ut7-route-inspector" data-ut7-route-steps={cellStepCount} data-ut7-route-at={plan.atCost} data-ut7-move-preview>
      <header><strong>Navigation Resolution</strong><span>{plan.atCost} AT · {cellStepCount} Cell-step{cellStepCount === 1 ? '' : 's'}</span></header>
      <div className="ut7-route-rows">
        {plan.timeline.map((trace) => (
          <div key={trace.atIndex} className={`behavior-${trace.behavior}`}>
            <b>AT{trace.atIndex}</b>
            <span>M{trace.beforeM}→M{trace.afterM}</span>
            <span>{axisLabel(trace.beforeAxis)}→{axisLabel(trace.afterAxis)}</span>
            <span>{trace.cellSteps.map((step) => `#${step.index} ${step.moveDirection} / ${axisLabel(step.newAxis)}`).join(' · ') || 'No displacement'}</span>
            <em>{trace.behavior} / {trace.thermalIntent}</em>
          </div>
        ))}
      </div>
    </div>
  )
}'''
)

replace_once(
    "  const [branchTarget, setBranchTarget] = useState<Coord>()",
    "  const [, setBranchTarget] = useState<Coord>()",
)

replace_once(
'''  const moveByCoord = useMemo(() => {
    const map = new Map<string, ActionPlan[]>()
    for (const target of basicMoveTargetCoords(lab, settings)) {
      const plans = basicMovePlansForTarget(lab, target, settings)
      if (plans.length > 0) map.set(coordKey(target), plans)
    }
    return map
  }, [lab, settings])''',
'''  const moveValidCoords = useMemo(() => basicMoveNavigationTargetCoords(lab), [lab])
  const hoverMovePlan = useMemo(() => {
    if (pendingAction !== 'move' || !hoverCoord) return undefined
    return basicMoveNavigationPlan(lab, hoverCoord, settings)
  }, [lab, settings, pendingAction, hoverCoord])'''
)

replace_once(
'''  const movePlans: BoardPlan[] = [...moveByCoord.entries()].map(([key, plans]) => {
    const [x, y] = key.split(',').map(Number)
    return { selector: { x, y }, plan: plans[0], alternatives: plans }
  })
  const boardPlans = pendingAction === 'move' ? movePlans : pendingAction === 'attack' ? attackPlans : pendingAction === 'launch' ? launchPlans : []
  const hoverPlans = hoverCoord ? moveByCoord.get(coordKey(hoverCoord)) : undefined
  const selectedBranchPlans = branchTarget ? moveByCoord.get(coordKey(branchTarget)) : undefined
  const hoveredBoardPlan = boardPlans.find((entry) => hoverCoord && sameCoord(entry.selector, hoverCoord))?.plan
  const preview = previewOverride ?? hoveredBoardPlan ?? (pendingAction === 'move' ? hoverPlans?.[0] : undefined)
  const previewPath = preview?.path.length ? [{ ...player.position }, ...preview.path.map((coord) => ({ ...coord }))] : []
  const moveValidCoords = movePlans.map((entry) => entry.selector)
  const launchValidCoords = launchPlans.map((entry) => entry.selector)
  const boardSelection: HexBoardSelection = pendingAction === 'move'
    ? { kind: 'momentum', action: 'drive', validCoords: moveValidCoords, route: previewPath }
    : pendingAction === 'attack'
      ? { kind: 'basic', action: 'attack' }
      : pendingAction === 'launch'
        ? { kind: 'momentum', action: 'drive', validCoords: launchValidCoords, route: previewPath }
        : inspectSelection''',
'''  const boardPlans = pendingAction === 'attack' ? attackPlans : pendingAction === 'launch' ? launchPlans : []
  const hoveredBoardPlan = boardPlans.find((entry) => hoverCoord && sameCoord(entry.selector, hoverCoord))?.plan
  const preview = previewOverride ?? (pendingAction === 'move' ? hoverMovePlan : hoveredBoardPlan)
  const previewPath = preview?.valid && preview.path.length ? [{ ...player.position }, ...preview.path.map((coord) => ({ ...coord }))] : []
  const launchValidCoords = launchPlans.map((entry) => entry.selector)
  const boardSelection: HexBoardSelection = pendingAction === 'move'
    ? { kind: 'momentum', action: 'drive', validCoords: moveValidCoords, route: previewPath }
    : pendingAction === 'attack'
      ? { kind: 'basic', action: 'attack' }
      : pendingAction === 'launch'
        ? { kind: 'momentum', action: 'drive', validCoords: launchValidCoords, route: previewPath }
        : inspectSelection'''
)

replace_once(
'''    if (pendingAction === 'move') {
      const plans = moveByCoord.get(coordKey(coord))
      if (plans?.length === 2) {
        setBranchTarget({ ...coord })
        setPreviewOverride(plans[0])
        return
      }
      if (plans?.[0]) {
        commitPlan(plans[0], true)
        return
      }
    }''',
'''    if (pendingAction === 'move') {
      const plan = basicMoveNavigationPlan(lab, coord, settings)
      if (plan.valid) {
        commitPlan(plan, true)
        return
      }
      setPreviewOverride(plan)
      return
    }'''
)

replace_once(
'''  const previewText = preview?.valid
    ? `${preview.label} · 1 AT · ${preview.summary}`
    : lab.logs[0]?.detail ?? 'Basic Move 先选择本 AT 的 Steering Intent；Axis / M 再逐 Cell-step 求解实际路径。' ''',
'''  const previewText = preview
    ? preview.valid
      ? `${preview.label} · ${preview.atCost} AT · ${preview.summary}`
      : `Navigation invalid · ${preview.reason}`
    : lab.logs[0]?.detail ?? 'Basic Move 选择最终 Target Cell；系统按寻路结果逐 AT、逐 Cell-step 执行惯性规则。' '''
)

replace_once('data-implementation="inertia-driving-basic-move-v3"', 'data-implementation="inertia-driving-navigation-v4"')
replace_once(
    '高亮的是本次 1 AT 内可表达的合法 Steering Intent。M0 为 Move1；Horizontal M 可逐格解析最多 2 Cell-step，每格最多 Redirect 60°。',
    '高亮的是可作为最终目的地的连通 Target Cell。系统会规划完整路线；每个 AT 内仍按 M / Axis / 每格最多 Redirect 60° 的规则逐格结算。',
)
replace_once('eventDurationMs={480}', 'eventDurationMs={320}')

replace_once(
'''              {selectedBranchPlans?.length === 2 && branchTarget && <div className="ut7-branch-choice" data-ut7-branch-choice><span>Reverse Steering Intent · choose turn side</span>{selectedBranchPlans.map((plan) => <button key={plan.branch} data-ut7-branch={plan.branch} onMouseEnter={() => setPreviewOverride(plan)} onClick={() => commitPlan(plan, true)}>{plan.branch === 'cw' ? 'Clockwise ↻' : 'Counter-clockwise ↺'} · 1AT</button>)}</div>}''',
''
)

replace_once(
'''<button data-action-id="basic-move" className={actionClass(pendingAction === 'move')} onClick={() => { setPreviewOverride(undefined); setBranchTarget(undefined); setPendingAction((current) => current === 'move' ? null : 'move') }}><div className="ut2-action-title"><div><b>1<small>AT</small></b><span>Basic Move</span></div><em>Basic</em></div><p>选择本 AT 的 Steering Intent；M / Axis 决定实际逐格路径与落点。Horizontal M 最多解析 2 Cell-step。</p><span className="ut3-card-cta">{pendingAction === 'move' ? '选择合法 Intent' : 'Move'}</span></button>''',
'''<button data-action-id="basic-move" className={actionClass(pendingAction === 'move')} onClick={() => { setPreviewOverride(undefined); setBranchTarget(undefined); setPendingAction((current) => current === 'move' ? null : 'move') }}><div className="ut2-action-title"><div><b>∑<small>AT</small></b><span>Basic Move</span></div><em>Navigate</em></div><p>选择最终 Target Cell；系统搜索惯性合法路线，并连续结算所需的多个 AT，直到到达目标。</p><span className="ut3-card-cta">{pendingAction === 'move' ? '选择 Target' : 'Move'}</span></button>'''
)

replace_once(
    "用 M1/M2/M3 East preset，悬停不同 Intent，观察同一 1AT 内的逐格路径、Redirect、M 与 Axis。",
    "选择远处 Target，观察完整多 AT 路线；每一行仍是一个真实 1 AT 的 Cell-step、Redirect、M 与 Axis 结算。",
)
replace_once(
    '<span>1 command = 1 AT</span><span>Rule-generated Intent</span><span>2-step Horizontal</span>',
    '<span>1 command = route AT</span><span>Final Target navigation</span><span>1AT inertia edges</span>',
)
replace_once(
    'M1/M2/M3 不等于远程自动导航；它们改变单个 1AT 内合法 Intent、实际路径与 Redirect 响应。',
    'M1/M2/M3 继续决定每个 1AT 边的真实运动；远程 Target 只把多个合法 1AT 边串成完整导航路线。',
)

path.write_text(source)
