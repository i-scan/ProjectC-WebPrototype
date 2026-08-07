import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = path.join(root, 'config', 'core-rules.v0.json')
const schemaPath = path.join(root, 'config', 'core-rules.schema.json')
const unifiedTimelinePath = path.join(root, 'config', 'experiments', 'val-012-action-chain.v2.json')

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const config = readJson(configPath)
const schema = readJson(schemaPath)
const unifiedTimeline = readJson(unifiedTimelinePath)

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

if (unifiedTimeline.rulesetId !== 'VAL-012-UT2') fail('Unified timeline ruleset ID must be VAL-012-UT2.')
if (unifiedTimeline.previousRulesetId !== 'VAL-012-UT1') fail('VAL-012-UT2 must name VAL-012-UT1 as its previous ruleset.')
if (unifiedTimeline.genericActionPoints !== false) fail('VAL-012-UT2 must not enable generic AP.')
if (unifiedTimeline.fixedHand !== true) fail('VAL-012-UT2 currently requires a fixed comparison hand.')
if (unifiedTimeline.thermalPeriodAt !== 8) fail('VAL-012-UT2 baseline Thermal Period must be 8 AT.')
if (unifiedTimeline.chainWindow.advancesWorldTime !== false) fail('VAL-012-UT2 Chain Window must not advance world time.')
if (unifiedTimeline.chainWindow.realTimeLimitSeconds !== null) fail('VAL-012-UT2 must not use a real-time Chain Window limit.')
const timelineActionIds = [
  ...unifiedTimeline.legacyActions.map((action) => action.id),
  ...unifiedTimeline.actions.map((action) => action.id),
]
if (new Set(timelineActionIds).size !== timelineActionIds.length) fail('Unified timeline action IDs must be unique.')
if (unifiedTimeline.legacyActions.some((action) => ![1, 2, 3].includes(action.actionTimeAt))) {
  fail('Unified timeline legacy actions must use 1, 2 or 3 AT.')
}
if (unifiedTimeline.actions.some((action) => ![1, 2, 3].includes(action.baseActionTimeAt))) {
  fail('UT2 actions must use 1, 2 or 3 base AT.')
}
if (unifiedTimeline.actions.some((action) => action.phases.length === 0 || action.phases.some((phase) => phase.durationAt !== 1))) {
  fail('Every UT2 action must contain one or more 1 AT phases.')
}
if (!unifiedTimeline.actions.some((action) => action.id === 'drive' && action.outro?.opensChainWindow)) {
  fail('VAL-012-UT2 must define Drive with a Chain Window outro.')
}
if (!unifiedTimeline.actions.some((action) => action.id === 'rush-strike' && action.intro?.skipPhaseIdWhenChained === 'start')) {
  fail('VAL-012-UT2 must define Rush Strike skipping Start when chained.')
}
if (unifiedTimeline.fixedHandActionIds.length !== 5) fail('VAL-012-UT2 comparison hand must contain five actions.')
for (const actionId of unifiedTimeline.fixedHandActionIds) {
  if (!timelineActionIds.includes(actionId)) fail(`Fixed hand references missing timeline action: ${actionId}`)
  if (!cardIds.includes(actionId)) fail(`Fixed hand references missing configured card: ${actionId}`)
}
const timelineActorIds = unifiedTimeline.actors.map((actor) => actor.id)
if (new Set(timelineActorIds).size !== timelineActorIds.length) fail('Unified timeline actor IDs must be unique.')
if (!timelineActorIds.includes('player')) fail('Unified timeline must define the player actor.')

console.log(`Validated ProjectC ruleset ${config.rulesetVersion} (schema ${config.schemaVersion}) and ${unifiedTimeline.rulesetId}.`)
