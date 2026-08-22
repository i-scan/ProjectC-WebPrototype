import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const evidencePath = resolve('artifacts/ut7-basic-move.json')
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))

function assert(condition, message, detail) {
  if (condition) return
  const suffix = detail === undefined ? '' : `\n${JSON.stringify(detail, null, 2)}`
  throw new Error(`${message}${suffix}`)
}

for (const key of ['initial', 'view2d', 'hybrid', 'radius10']) {
  const snapshot = evidence[key]
  const layout = snapshot?.layout
  assert(layout?.boardFrame && layout?.hand, `${key}: board/action-hand geometry evidence is missing`, snapshot)
  assert(
    layout.boardFrame.bottom <= layout.hand.top,
    `${key}: board frame overlaps the action hand`,
    { boardFrame: layout.boardFrame, hand: layout.hand },
  )
}

console.log('Verified impulse lab vertical composition: board frame never overlaps the action hand in 3D, 2D, Hybrid, or R10 evidence.')
