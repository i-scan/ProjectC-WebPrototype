import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
const wrapperPath = fileURLToPath(new URL('./verify-browser-layout-ci.mjs', import.meta.url))
const ut4Path = fileURLToPath(new URL('./verify-ut4-sandbox.mjs', import.meta.url))
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
const wrapper = readFileSync(wrapperPath, 'utf8')
const ut4 = readFileSync(ut4Path, 'utf8')

describe('browser verification CI resilience', () => {
  it('routes Hex checks through the transient-startup retry wrapper and then verifies UT4', () => {
    expect(packageJson.scripts['verify:browser']).toBe('node scripts/verify-browser-layout-ci.mjs && node scripts/verify-ut4-sandbox.mjs')
    expect(wrapper).toContain("BROWSER_VERIFY_ATTEMPTS || '3'")
    expect(wrapper).toContain("['scripts/verify-browser-layout.mjs']")
    expect(wrapper).toContain("result.output.includes('Chrome DevTools did not become ready')")
    expect(ut4).toContain('VAL-012-UT4')
    expect(ut4).toContain('coupled-inertia-sandbox-v1')
    expect(ut4).toContain('3D Hex canvas is not visible')
    expect(ut4).toContain('UT4 coupled inertia sandbox verified in real Chrome')
  })

  it('does not retry deterministic Hex layout failures', () => {
    expect(wrapper).toContain('if (!chromeStartupFailure || attempt === maxAttempts)')
    expect(wrapper).toContain('process.exit(result.code)')
  })
})
