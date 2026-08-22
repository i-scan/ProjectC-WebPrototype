import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
const currentWrapperPath = fileURLToPath(new URL('./verify-current-browser-ci.mjs', import.meta.url))
const historicalWrapperPath = fileURLToPath(new URL('./verify-browser-layout-ci.mjs', import.meta.url))
const ut7Path = fileURLToPath(new URL('./verify-ut7-basic-move.mjs', import.meta.url))
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
const currentWrapper = readFileSync(currentWrapperPath, 'utf8')
const historicalWrapper = readFileSync(historicalWrapperPath, 'utf8')
const ut7 = readFileSync(ut7Path, 'utf8')

describe('browser verification CI resilience', () => {
  it('runs the impulse-driving browser experiment through the Chrome startup retry wrapper', () => {
    expect(packageJson.scripts['verify:browser']).toBe('node scripts/verify-current-browser-ci.mjs && node scripts/verify-impulse-layout-evidence.mjs')
    expect(currentWrapper).toContain("BROWSER_VERIFY_ATTEMPTS || '3'")
    expect(currentWrapper).toContain("['scripts/verify-ut7-basic-move.mjs']")
    expect(currentWrapper).toContain("result.output.includes('Chrome DevTools did not become ready')")
    expect(currentWrapper).toContain("spawnSync('pkill', ['-f', '--', pattern]")
    expect(currentWrapper).toContain('cleaning stale current-verifier Chrome before retry')
    expect(ut7).toContain('impulse-inertia-input-v1')
    expect(ut7).toContain('M0 Drive commit')
    expect(ut7).toContain('persistent M1 Coast')
    expect(ut7).toContain('M3 forced collision preview')
    expect(ut7).toContain('M3 counter impulse preview')
    expect(ut7).toContain('restored 2D view')
    expect(ut7).toContain('Hybrid playback mode')
    expect(ut7).toContain('R10 impulse board')
  })

  it('keeps the previous layout retry verifier archived but out of the current smoke chain', () => {
    expect(historicalWrapper).toContain("['scripts/verify-browser-layout.mjs']")
    expect(packageJson.scripts['verify:browser']).not.toContain('verify-browser-layout-ci.mjs')
    expect(packageJson.scripts['verify:browser']).not.toContain('verify-ut5-axis-inertia.mjs')
    expect(packageJson.scripts['verify:browser']).not.toContain('verify-ut6-actor-loop.mjs')
  })

  it('does not retry deterministic current-browser failures', () => {
    expect(currentWrapper).toContain('if (!chromeStartupFailure || attempt === maxAttempts) process.exit(result.code)')
  })
})
