import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = path.join(root, 'config', 'core-rules.v0.json')
const schemaPath = path.join(root, 'config', 'core-rules.schema.json')
const unifiedTimelinePath = path.join(root, 'config', 'experiments', 'val-012-momentum-lab.v3.json')
const coupledInertiaPath = path.join(root, 'config', 'experiments', 'val-012-coupled-inertia-lab.v4.json')
const axisInertiaPath = path.join(root, 'config', 'experiments', 'val-012-axis-inertia-lab.v5.json')
const actorLoopPath = path.join(root, 'config', 'experiments', 'val-012-actor-loop-v0.v6.json')
const inertiaDrivingPath = path.join(root, 'config', 'experiments', 'val-012-inertia-driving.v7.json')

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const config = readJson(configPath)
const schema = readJson(schemaPath)
const unifiedTimeline = readJson(unifiedTimelinePath)
const coupledInertia = readJson(coupledInertiaPath)
const axisInertia = readJson(axisInertiaPath)
const actorLoop = readJson(actorLoopPath)
const inertiaDriving = readJson(inertiaDrivingPath)

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validate = ajv.compile(schema)

if (!validate(config)) {
  console.error('core-rules.v0.json failed JSON Schema validation:')
  console.error(ajv.errorsText(validate.errors, { separator: '\n' }))
  process.exit(1)
}

const fail = (message) => {
  console.error(`Rule reference validation failed: ${message}`)
  process.exit(1)
}

const cardIds = config.cards.map((card) => card.id)
if (new Set(cardIds).size !== cardIds.length) fail('Card IDs must be unique.')
if (cardIds.length !== config.deck.initialOrder.length) fail('Deck order must include every configured card exactly once.')
for (const cardId of config.deck.initialOrder) {
  if (!cardIds.includes(cardId)) fail(`Deck references missing card: ${cardId}`)
}

const equipmentIds = new Set(Object.keys(config.equipment))
for (const [actorId, actor] of Object.entries(config.actors)) {
  for (const equipmentId of actor.equipment ?? []) {
    if (!equipmentIds.has(equipmentId)) fail(`Actor ${actorId} references missing equipment: ${equipmentId}`)
  }
}

if (!config.turn.availableModes.includes(config.turn.defaultMode)) fail(`Default turn mode is not available: ${config.turn.defaultMode}`)
if (!config.turn.phasesByMode[config.turn.defaultMode]) fail(`Default turn mode has no phase sequence: ${config.turn.defaultMode}`)

const room = config.mapProfiles.room
if (room.defaultRadius < room.minimumRadius || room.defaultRadius > room.maximumRadius) fail('Room default radius is outside the supported range.')
if (config.temperature.directMinimum < config.temperature.minimum) fail('Direct minimum temperature is below the complete minimum.')
if (config.temperature.directMaximum > config.temperature.maximum) fail('Direct maximum temperature is above the complete maximum.')

// UT3 remains historical/reference and powers #hex-legacy.
if (unifiedTimeline.rulesetId !== 'VAL-012-UT3') fail('Unified timeline ruleset ID must be VAL-012-UT3.')
if (unifiedTimeline.previousRulesetId !== 'VAL-012-UT2') fail('VAL-012-UT3 must name VAL-012-UT2 as its previous ruleset.')
if (unifiedTimeline.genericActionPoints !== false) fail('VAL-012-UT3 must not enable generic AP.')
if (unifiedTimeline.fixedHand !== true) fail('VAL-012-UT3 currently requires a fixed comparison hand.')
if (unifiedTimeline.thermalPeriodAt !== 8) fail('VAL-012-UT3 baseline Thermal Period must be 8 AT.')
if (unifiedTimeline.chainWindow.advancesWorldTime !== false) fail('Historical UT3 Chain Window must not advance world time.')
if (unifiedTimeline.chainWindow.realTimeLimitSeconds !== null) fail('Historical UT3 must not use a real-time Chain Window limit.')
const timelineActionIds = [...unifiedTimeline.legacyActions.map((action) => action.id), ...unifiedTimeline.actions.map((action) => action.id)]
if (new Set(timelineActionIds).size !== timelineActionIds.length) fail('Unified timeline action IDs must be unique.')
if (unifiedTimeline.legacyActions.some((action) => ![1, 2, 3].includes(action.actionTimeAt))) fail('Unified timeline legacy actions must use 1, 2 or 3 AT.')
if (unifiedTimeline.actions.some((action) => ![1, 2, 3].includes(action.baseActionTimeAt))) fail('UT3 actions must use 1, 2 or 3 base AT.')
if (unifiedTimeline.actions.some((action) => action.phases.length === 0 || action.phases.some((phase) => phase.durationAt !== 1))) fail('Every UT3 action must contain one or more 1 AT phases.')
if (!unifiedTimeline.actions.some((action) => action.id === 'drive' && action.outro?.opensChainWindow)) fail('Historical UT3 must define Drive with a Chain Window outro.')
if (!unifiedTimeline.actions.some((action) => action.id === 'rush-strike' && action.intro?.skipPhaseIdWhenChained === 'start')) fail('Historical UT3 must define Rush Strike skipping Start when chained.')
if (!unifiedTimeline.actions.some((action) => action.id === 'brake' && action.baseActionTimeAt === 1)) fail('Historical UT3 must define Brake at 1 AT.')
if (unifiedTimeline.spatialMomentum?.formalTerms?.includes('Active Momentum') !== true) fail('Historical UT3 must distinguish Active Momentum from Pending Momentum.')
if (unifiedTimeline.forcedMotion?.secondaryImpactLimit !== 1) fail('Historical UT3 must cap secondary impact at one.')
if (unifiedTimeline.fixedHandActionIds.length !== 5) fail('UT3 comparison hand must contain five actions.')
for (const actionId of unifiedTimeline.fixedHandActionIds) {
  if (!timelineActionIds.includes(actionId)) fail(`Fixed hand references missing timeline action: ${actionId}`)
  if (!cardIds.includes(actionId)) fail(`Fixed hand references missing configured card: ${actionId}`)
}
const timelineActorIds = unifiedTimeline.actors.map((actor) => actor.id)
if (new Set(timelineActorIds).size !== timelineActorIds.length) fail('Unified timeline actor IDs must be unique.')
if (!timelineActorIds.includes('player')) fail('Unified timeline must define the player actor.')

// UT4 and UT5 remain reproducible historical/diagnostic experiments.
if (coupledInertia.rulesetVersion !== 'VAL-012-UT4') fail('Historical coupled inertia ruleset must remain VAL-012-UT4.')
if (coupledInertia.implementationId !== 'coupled-inertia-sandbox-v1') fail('Historical UT4 implementation ID changed unexpectedly.')
if (axisInertia.rulesetVersion !== 'VAL-012-UT5') fail('Historical/diagnostic Axis Inertia ruleset must remain VAL-012-UT5.')
if (axisInertia.implementationId !== 'axis-inertia-sandbox-v1') fail('UT5 implementation ID must remain axis-inertia-sandbox-v1.')
if (axisInertia.thermal.coldDomainThreshold !== -3 || axisInertia.thermal.hotDomainThreshold !== 3) fail('UT5 absolute Thermal Domain thresholds must remain -3 and +3.')
if (axisInertia.spatial.maxLevel !== 3) fail('UT5 unified Momentum must remain M0-M3.')

// UT6 remains reproducible on #hex-ut6. Keep its candidate data intact so
// producer-reviewed Spend/no-refund evidence can still be compared against UT7.
if (actorLoop.rulesetVersion !== 'VAL-012-UT6-candidate') fail('Historical Actor Loop ruleset must remain VAL-012-UT6-candidate.')
if (actorLoop.implementationId !== 'actor-loop-playground-v0') fail('UT6 implementation ID must remain actor-loop-playground-v0.')
if (actorLoop.momentum.maxLevel !== 3) fail('UT6 Momentum must remain M0-M3.')
if (actorLoop.momentum.naturalBuildCap !== 1) fail('UT6 Natural Build cap must remain M1 for historical reproduction.')
if (actorLoop.momentum.domainBuildCap !== 3) fail('UT6 Domain Build cap must remain M3 for historical reproduction.')
if (!['axis-first', 'immediate-m1'].includes(actorLoop.momentum.naturalBuildStartMode)) fail('UT6 Natural Build start mode must remain an explicit A/B.')
if (actorLoop.momentum.basicMoveSpendEnabled !== true) fail('UT6 Basic Move Momentum enhancement must Spend.')
if (actorLoop.momentum.basicAttackDownSpendEnabled !== true) fail('UT6 Grounded Basic Attack Momentum enhancement must Spend.')
if (actorLoop.momentum.rebuildSpentMomentumSameAt !== false) fail('UT6 Same-AT Basic Spend refund must remain disabled.')
if (![1, 2].includes(actorLoop.momentum.launchBrakeMinM)) fail('UT6 Launch/Brake MinM must remain a 1 vs 2 candidate.')
if (actorLoop.momentum.momentumProtectionEnabled !== false) fail('UT6 Momentum Protection must remain deferred/off in Actor Loop v0.')
if (actorLoop.actions.basicMoveAt !== 1 || actorLoop.actions.basicAttackAt !== 1) fail('UT6 Basic Move and Basic Attack must remain 1 AT baselines.')
if (actorLoop.actions.launchAt !== 1 || actorLoop.actions.brakeAt !== 1) fail('UT6 Launch and Brake must remain 1 AT baselines.')
if (actorLoop.actions.drivePhaseAt !== 1 || actorLoop.actions.drivePhaseCount !== 2) fail('UT6 Drive must remain two committed 1 AT phases.')
if (JSON.stringify(actorLoop.actions.drivePhaseDistances) !== JSON.stringify([1, 2])) fail('UT6 Drive phase distances must remain Move1 -> Move2 for the historical sample.')
if (actorLoop.weapon.downSpendIncomingM !== 1) fail('UT6 Grounded Basic Attack must convert Spend 1 Down M into Incoming M1.')
if (actorLoop.conversion.momentumLoss !== 1) fail('UT6 Launch/Brake conversion must lose one Momentum layer in the historical candidate.')
if (actorLoop.release.groundBreak.radius !== 2) fail('UT6 Ground Break sample must remain R2.')
if (actorLoop.release.groundBreak.ring1IncomingM !== 2 || actorLoop.release.groundBreak.ring2IncomingM !== 1) fail('UT6 Ground Break ring Incoming values must remain M2/M1.')
if (!['direct', 'drift', 'mixed'].includes(actorLoop.release.thermalReleaseMode)) fail('UT6 Thermal Release must use the Direct/Drift/Mixed A/B family.')
if (actorLoop.at0.enabled !== true) fail('UT6 AT0 sample must remain enabled for historical validation.')
if (actorLoop.at0.safetyMode !== 'must-consume-nonrecoverable-state') fail('UT6 AT0 baseline must consume a finite/nonrecoverable charge.')
if (actorLoop.at0.weaponAttacksPerGlobalAt !== 1) fail('UT6 AT0 sample must cap free Weapon Attacks to one per Global AT.')

// UT7 owns the live #hex-prototype route. It replaces UT6 cap-by-Domain driving
// semantics with Target-driven Steering, Side cap, Domain efficiency, Breakaway,
// Passive Dissipation, and behavior-derived Thermal intent.
if (inertiaDriving.rulesetVersion !== 'VAL-012-UT7-candidate') fail('Live inertia driving ruleset must be VAL-012-UT7-candidate.')
if (inertiaDriving.implementationId !== 'inertia-driving-playground-v1') fail('UT7 implementation ID must be inertia-driving-playground-v1.')
if (inertiaDriving.prototypeRoute !== '#hex-prototype') fail('UT7 must own the live #hex-prototype route.')
if (inertiaDriving.momentum.maxLevel !== 3) fail('UT7 Momentum must remain M0-M3.')
if (!['axis-first', 'immediate-m1'].includes(inertiaDriving.momentum.naturalBuildStartMode)) fail('UT7 Natural Build start mode must remain an explicit A/B.')
if (inertiaDriving.momentum.normalBuildAmount !== 1) fail('UT7 normal compatible Build baseline must be +1M.')
if (inertiaDriving.momentum.domainBuildAmount !== 2) fail('UT7 first-test matching Domain Build efficiency must be +2M.')
if (inertiaDriving.momentum.rebuildReducedMomentumSameAt !== false) fail('UT7 reduced Momentum must not refund in the same AT.')
if (inertiaDriving.steering.redirectStepsPerCell !== 1) fail('UT7 Redirect must be limited to one Hex direction step (60 degrees) per cell-step.')
if (inertiaDriving.steering.horizontalCellStepsPerAt !== 2) fail('UT7 first-test Horizontal movement budget must be two cells per AT.')
if (inertiaDriving.steering.m0MoveCellsPerAt !== 1) fail('UT7 M0 Basic Move must remain one cell per AT.')
if (inertiaDriving.steering.allowReverseBranchChoice !== true) fail('UT7 must expose clockwise/counter-clockwise reverse branch choice.')
if (inertiaDriving.breakaway.reductionPerAt !== 1) fail('UT7 Down Breakaway baseline must reduce 1M per AT.')
if (inertiaDriving.breakaway.hotSideAssistEnabled !== false) fail('UT7 Hot-side Breakaway assist must default OFF as an experiment setting.')
if (inertiaDriving.passive.horizontalDissipationPerAt !== 1) fail('UT7 passive Horizontal stop must dissipate 1M per AT.')
if (inertiaDriving.weapon.downSpendIncomingM !== 1) fail('UT7 Grounded Basic Attack must Spend Down M into Incoming M1.')
if (inertiaDriving.playground.minimumRadius !== 4 || inertiaDriving.playground.maximumRadius !== 10 || inertiaDriving.playground.defaultRadius !== 7) fail('UT7 Playground radius must support 4..10 with default 7.')
if (inertiaDriving.playground.spawnEnemiesDefault !== true) fail('UT7 Spawn Enemies must default ON.')
if (inertiaDriving.thermal.hotDomainThreshold !== 3 || inertiaDriving.thermal.coldDomainThreshold !== -3) fail('UT7 absolute Thermal Domain thresholds must remain +3/-3.')
if (!(inertiaDriving.thermal.behaviorDriftImpulse > 0)) fail('UT7 behavior Thermal impulse must remain an explicit positive experiment parameter.')
if (!(inertiaDriving.thermal.balancingDriftRetention >= 0 && inertiaDriving.thermal.balancingDriftRetention <= 1)) fail('UT7 Balancing Drift retention must be a 0..1 experiment parameter.')

console.log(`Validated ProjectC ruleset ${config.rulesetVersion} (schema ${config.schemaVersion}), historical ${unifiedTimeline.rulesetId}/${coupledInertia.rulesetVersion}/${axisInertia.rulesetVersion}/${actorLoop.rulesetVersion}, and live ${inertiaDriving.rulesetVersion}.`)
