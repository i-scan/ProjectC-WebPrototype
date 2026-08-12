import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
const wrapperPath = fileURLToPath(new URL('./verify-browser-layout-ci.mjs', import.meta.url))
const ut5Path = fileURLToPath(new URL('./verify-ut5-axis-inertia.mjs', import.meta.url))
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
const wrapper = readFileSync(wrapperPath, 'utf8')
const ut5 = readFileSync(ut5Path, 'utf8')

describe('browser verification CI resilience', () => {
  it('routes generic Hex checks through the retry wrapper and then verifies live UT5', () => {
    expect(packageJson.scripts['verify:browser']).toBe('node scripts/verify-browser-layout-ci.mjs && node scripts/verify-ut5-axis-inertia.mjs')
    expect(wrapper).toContain("BROWSER_VERIFY_ATTEMPTS || '3'")
    expect(wrapper).toContain("['scripts/verify-browser-layout.mjs']")
    expect(wrapper).toContain("result.output.includes('Chrome DevTools did not become ready')")
    expect(ut5).toContain('VAL-012-UT5')
    expect(ut5).toContain('Nobody Dies must be the final right-sidebar control')
    expect(ut5).toContain('UT5 Cold Down build')
    expect(ut5).toContain('UT5 Neutral persistent M')
    expect(ut5).toContain('UT5 0 AT hit')
    expect(ut5).toContain('UT5 same-AT hit thermal evolution')
    expect(ut5).toContain('UT5 Reaction Sidestep choice')
    expect(ut5).toContain('UT5 W DrivePlan preview')
    expect(ut5).toContain('UT5 committed W DrivePlan')
    expect(ut5).toContain('preview=execution verified in real Chrome')
  })

  it('does not retry deterministic Hex layout failures', () => {
    expect(wrapper).toContain('if (!chromeStartupFailure || attempt === maxAttempts)')
    expect(wrapper).toContain('process.exit(result.code)')
  })
})
