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

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const config = readJson(configPath)
const schema = readJson(schemaPath)
const unifiedTimeline = readJson(unifiedTimelinePath)
const coupledInertia = readJson(coupledInertiaPath)

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

if (config.temperature.directMinimum < config.temperature.minimum) {
  fail('Direct minimum temperature is below the complete minimum.')
}
if (config.temperature.directMaximum > config.temperature.maximum) {
  fail('Direct maximum temperature is above the complete maximum.')
}

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
if (unifiedTimeline.legacyActions.some((action) => ![1, 2, 3].includes(action.actionTimeAt))) {
  fail('Unified timeline legacy actions must use 1, 2 or 3 AT.')
}
if (unifiedTimeline.actions.some((action) => ![1, 2, 3].includes(action.baseActionTimeAt))) {
  fail('UT3 actions must use 1, 2 or 3 base AT.')
}
if (unifiedTimeline.actions.some((action) => action.phases.length === 0 || action.phases.some((phase) => phase.durationAt !== 1))) {
  fail('Every UT3 action must contain one or more 1 AT phases.')
}
if (!unifiedTimeline.actions.some((action) => action.id === 'drive' && action.outro?.opensChainWindow)) {
  fail('VAL-012-UT3 must define Drive with a Chain Window outro.')
}
if (!unifiedTimeline.actions.some((action) => action.id === 'rush-strike' && action.intro?.skipPhaseIdWhenChained === 'start')) {
  fail('VAL-012-UT3 must define Rush Strike skipping Start when chained.')
}
if (!unifiedTimeline.actions.some((action) => action.id === 'brake' && action.baseActionTimeAt === 1)) {
  fail('VAL-012-UT3 must define the contextual Brake action at 1 AT.')
}
if (unifiedTimeline.spatialMomentum?.formalTerms?.includes('Active Momentum') !== true) {
  fail('VAL-012-UT3 must distinguish Active Momentum from Pending Momentum.')
}
if (unifiedTimeline.forcedMotion?.secondaryImpactLimit !== 1) {
  fail('VAL-012-UT3 must cap secondary impact at one.')
}
if (unifiedTimeline.fixedHandActionIds.length !== 5) fail('VAL-012-UT3 comparison hand must contain five actions.')
for (const actionId of unifiedTimeline.fixedHandActionIds) {
  if (!timelineActionIds.includes(actionId)) fail(`Fixed hand references missing timeline action: ${actionId}`)
  if (!cardIds.includes(actionId)) fail(`Fixed hand references missing configured card: ${actionId}`)
}
const timelineActorIds = unifiedTimeline.actors.map((actor) => actor.id)
if (new Set(timelineActorIds).size !== timelineActorIds.length) fail('Unified timeline actor IDs must be unique.')
if (!timelineActorIds.includes('player')) fail('Unified timeline must define the player actor.')

// UT4 is the active Inertia Lab candidate. Balance-sensitive values remain
// tunable, but the structural contracts from the handoff are fixed here.
if (coupledInertia.rulesetVersion !== 'VAL-012-UT4') fail('Coupled Inertia ruleset must be VAL-012-UT4.')
if (coupledInertia.implementationId !== 'coupled-inertia-sandbox-v1') fail('UT4 implementation ID must be coupled-inertia-sandbox-v1.')
if (coupledInertia.thermal.coldDomainThreshold !== -3 || coupledInertia.thermal.hotDomainThreshold !== 3) {
  fail('UT4 absolute Thermal Domain thresholds must be -3 and +3.')
}
if (coupledInertia.thermal.setPointMin !== -2 || coupledInertia.thermal.setPointMax !== 2) {
  fail('UT4 Set Point diagnostic range must remain -2 to +2.')
}
if (!(coupledInertia.thermal.damping >= 0)) fail('UT4 Damping must be non-negative.')
if (!(coupledInertia.thermal.thermalPeriodAt > 0)) fail('UT4 Thermal Period must be positive.')
if (!Number.isInteger(coupledInertia.thermal.integrationSubstepsPerAt) || coupledInertia.thermal.integrationSubstepsPerAt < 4) {
  fail('UT4 Thermal solver must use at least four integration substeps per AT.')
}
if (coupledInertia.spatial.maxLevel !== 3) fail('UT4 Spatial Inertia must remain M0-M3.')
if (coupledInertia.spatial.steeringLoss60 < 0 || coupledInertia.spatial.steeringLoss120 < coupledInertia.spatial.steeringLoss60) {
  fail('UT4 steering loss must be monotonic from 60 to 120 degrees.')
}
if (coupledInertia.actions.basicMoveAt !== 1 || coupledInertia.actions.defaultWeaponAt !== 1 || coupledInertia.actions.holdPositionAt !== 1) {
  fail('UT4 baseline Move / Default Weapon / Hold actions must be 1 AT.')
}
if (coupledInertia.actions.drivePhaseAt !== 1 || coupledInertia.actions.drivePhaseCount !== 3) {
  fail('UT4 Drive baseline must be three committed 1 AT phases.')
}
if (coupledInertia.actions.heavyReleaseAt !== 2) fail('UT4 Heavy Release baseline must be 2 AT.')
if (coupledInertia.actions.brakeAt !== 1) fail('UT4 Brake baseline must be 1 AT.')
for (const hitType of ['normal', 'push', 'heavy']) {
  if (!coupledInertia.hits[hitType]) fail(`UT4 missing hit profile: ${hitType}`)
  if (coupledInertia.hits[hitType].damage < 0 || coupledInertia.hits[hitType].forcedStrength < 0) {
    fail(`UT4 hit profile ${hitType} contains a negative value.`)
  }
}

console.log(`Validated ProjectC ruleset ${config.rulesetVersion} (schema ${config.schemaVersion}), ${unifiedTimeline.rulesetId}, and ${coupledInertia.rulesetVersion}.`)
