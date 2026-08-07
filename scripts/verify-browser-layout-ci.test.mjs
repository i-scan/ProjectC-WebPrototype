import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
const wrapperPath = fileURLToPath(new URL('./verify-browser-layout-ci.mjs', import.meta.url))
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
const wrapper = readFileSync(wrapperPath, 'utf8')

describe('browser verification CI resilience', () => {
  it('routes browser checks through the transient-startup retry wrapper', () => {
    expect(packageJson.scripts['verify:browser']).toBe('node scripts/verify-browser-layout-ci.mjs')
    expect(wrapper).toContain("BROWSER_VERIFY_ATTEMPTS || '3'")
    expect(wrapper).toContain("['scripts/verify-browser-layout.mjs']")
    expect(wrapper).toContain("result.output.includes('Chrome DevTools did not become ready')")
  })

  it('does not retry deterministic layout failures', () => {
    expect(wrapper).toContain('if (!chromeStartupFailure || attempt === maxAttempts)')
    expect(wrapper).toContain('process.exit(result.code)')
  })
})
