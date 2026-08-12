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

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const config = readJson(configPath)
const schema = readJson(schemaPath)
const unifiedTimeline = readJson(unifiedTimelinePath)
const coupledInertia = readJson(coupledInertiaPath)
const axisInertia = readJson(axisInertiaPath)

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

if (!config.turn.availableModes.includes(config.turn.defaultMode)) {
  fail(`Default turn mode is not available: ${config.turn.defaultMode}`)
}
if (!config.turn.phasesByMode[config.turn.defaultMode]) {
  fail(`Default turn mode has no phase sequence: ${config.turn.defaultMode}`)
}

const room = config.mapProfiles.room
if (room.defaultRadius < room.minimumRadius || room.defaultRadius > room.maximumRadius) {
  fail('Room default radius is outside the supported range.')
}
if (config.temperature.directMinimum < config.temperature.minimum) fail('Direct minimum temperature is below the complete minimum.')
if (config.temperature.directMaximum > config.temperature.maximum) fail('Direct maximum temperature is above the complete maximum.')

// UT3 remains a supported historical/reference experiment used by Hex6.
if (unifiedTimeline.rulesetId !== 'VAL-012-UT3') fail('Unified timeline ruleset ID must be VAL-012-UT3.')
if (unifiedTimeline.previousRulesetId !== 'VAL-012-UT2') fail('VAL-012-UT3 must name VAL-012-UT2 as its previous ruleset.')
if (unifiedTimeline.genericActionPoints !== false) fail('VAL-012-UT3 must not enable generic AP.')
if (unifiedTimeline.fixedHand !== true) fail('VAL-012-UT3 currently requires a fixed comparison hand.')
if (unifiedTimeline.thermalPeriodAt !== 8) fail('VAL-012-UT3 baseline Thermal Period must be 8 AT.')
if (unifiedTimeline.chainWindow.advancesWorldTime !== false) fail('VAL-012-UT3 Chain Window must not advance world time.')
if (unifiedTimeline.chainWindow.realTimeLimitSeconds !== null) fail('VAL-012-UT3 must not use a real-time Chain Window limit.')
const timelineActionIds = [
  ...unifiedTimeline.legacyActions.map((action) => action.id),
  ...unifiedTimeline.actions.map((action) => action.id),
]
if (new Set(timelineActionIds).size !== timelineActionIds.length) fail('Unified timeline action IDs must be unique.')
if (unifiedTimeline.legacyActions.some((action) => ![1, 2, 3].includes(action.actionTimeAt))) fail('Unified timeline legacy actions must use 1, 2 or 3 AT.')
if (unifiedTimeline.actions.some((action) => ![1, 2, 3].includes(action.baseActionTimeAt))) fail('UT3 actions must use 1, 2 or 3 base AT.')
if (unifiedTimeline.actions.some((action) => action.phases.length === 0 || action.phases.some((phase) => phase.durationAt !== 1))) fail('Every UT3 action must contain one or more 1 AT phases.')
if (!unifiedTimeline.actions.some((action) => action.id === 'drive' && action.outro?.opensChainWindow)) fail('VAL-012-UT3 must define Drive with a Chain Window outro.')
if (!unifiedTimeline.actions.some((action) => action.id === 'rush-strike' && action.intro?.skipPhaseIdWhenChained === 'start')) fail('VAL-012-UT3 must define Rush Strike skipping Start when chained.')
if (!unifiedTimeline.actions.some((action) => action.id === 'brake' && action.baseActionTimeAt === 1)) fail('VAL-012-UT3 must define the contextual Brake action at 1 AT.')
if (unifiedTimeline.spatialMomentum?.formalTerms?.includes('Active Momentum') !== true) fail('VAL-012-UT3 must distinguish Active Momentum from Pending Momentum.')
if (unifiedTimeline.forcedMotion?.secondaryImpactLimit !== 1) fail('VAL-012-UT3 must cap secondary impact at one.')
if (unifiedTimeline.fixedHandActionIds.length !== 5) fail('VAL-012-UT3 comparison hand must contain five actions.')
for (const actionId of unifiedTimeline.fixedHandActionIds) {
  if (!timelineActionIds.includes(actionId)) fail(`Fixed hand references missing timeline action: ${actionId}`)
  if (!cardIds.includes(actionId)) fail(`Fixed hand references missing configured card: ${actionId}`)
}
const timelineActorIds = unifiedTimeline.actors.map((actor) => actor.id)
if (new Set(timelineActorIds).size !== timelineActorIds.length) fail('Unified timeline actor IDs must be unique.')
if (!timelineActorIds.includes('player')) fail('Unified timeline must define the player actor.')

// UT4 remains historical so existing comparisons stay reproducible.
if (coupledInertia.rulesetVersion !== 'VAL-012-UT4') fail('Historical coupled inertia ruleset must remain VAL-012-UT4.')
if (coupledInertia.implementationId !== 'coupled-inertia-sandbox-v1') fail('Historical UT4 implementation ID changed unexpectedly.')

// UT5 is the live Inertia Lab candidate. Structural contracts are fixed;
// balance-sensitive values remain intentionally tunable.
if (axisInertia.rulesetVersion !== 'VAL-012-UT5') fail('Axis Inertia ruleset must be VAL-012-UT5.')
if (axisInertia.implementationId !== 'axis-inertia-sandbox-v1') fail('UT5 implementation ID must be axis-inertia-sandbox-v1.')
if (axisInertia.thermal.coldDomainThreshold !== -3 || axisInertia.thermal.hotDomainThreshold !== 3) fail('UT5 absolute Thermal Domain thresholds must be -3 and +3.')
if (axisInertia.thermal.setPointMin !== -2 || axisInertia.thermal.setPointMax !== 2) fail('UT5 Set Point diagnostic range must remain -2 to +2.')
if (!(axisInertia.thermal.damping >= 0)) fail('UT5 Damping must be non-negative.')
if (!(axisInertia.thermal.thermalPeriodAt > 0)) fail('UT5 Thermal Period must be positive.')
if (!Number.isInteger(axisInertia.thermal.integrationSubstepsPerAt) || axisInertia.thermal.integrationSubstepsPerAt < 4) fail('UT5 Thermal solver must use at least four integration substeps per AT.')
if (axisInertia.spatial.maxLevel !== 3) fail('UT5 unified Momentum must remain M0-M3.')
if (axisInertia.spatial.momentumExchangeCap < 0 || axisInertia.spatial.momentumExchangeCap > axisInertia.spatial.maxLevel) fail('UT5 Momentum Exchange Cap must be within M0-M3.')
if (axisInertia.spatial.steeringCost60 < 0 || axisInertia.spatial.steeringCost120 < axisInertia.spatial.steeringCost60) fail('UT5 Steering cost must be monotonic from 60 to 120 degrees.')
if (axisInertia.spatial.minReactionSidestepM < axisInertia.spatial.reactionSidestepCostM) fail('UT5 Reaction Sidestep minimum M must cover its M cost.')
if (axisInertia.spatial.minFallbackM < axisInertia.spatial.fallbackCostM) fail('UT5 Failed Occupancy Fallback minimum M must cover its M cost.')
if (axisInertia.actions.basicMoveAt !== 1 || axisInertia.actions.defaultWeaponAt !== 1 || axisInertia.actions.holdPositionAt !== 1) fail('UT5 baseline Move / Default Weapon / Hold actions must be 1 AT.')
if (axisInertia.actions.drivePhaseAt !== 1 || axisInertia.actions.drivePhaseCount !== 3) fail('UT5 Drive baseline must remain three committed 1 AT phases.')
if (axisInertia.actions.heavyReleaseAt !== 2) fail('UT5 Heavy Release baseline must be 2 AT.')
if (axisInertia.actions.brakeAt !== 1) fail('UT5 Brake baseline must be 1 AT.')
for (const hitType of ['normal', 'push', 'heavy']) {
  if (!axisInertia.hits[hitType]) fail(`UT5 missing hit profile: ${hitType}`)
  if (axisInertia.hits[hitType].damage < 0 || axisInertia.hits[hitType].forcedStrength < 0) fail(`UT5 hit profile ${hitType} contains a negative value.`)
}

console.log(`Validated ProjectC ruleset ${config.rulesetVersion} (schema ${config.schemaVersion}), ${unifiedTimeline.rulesetId}, historical ${coupledInertia.rulesetVersion}, and live ${axisInertia.rulesetVersion}.`)
