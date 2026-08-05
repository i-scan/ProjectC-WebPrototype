import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const bootstrapPath = fileURLToPath(new URL('./agent-apply-card-feedback-fix.yml', import.meta.url))
const bootstrap = readFileSync(bootstrapPath, 'utf8')

describe('one-time card feedback bootstrap', () => {
  it('creates a review branch and removes itself from the implementation change', () => {
    expect(bootstrap).toContain('git switch -c agent/fix-failed-card-feedback-code')
    expect(bootstrap).toContain('git rm .github/workflows/agent-apply-card-feedback-fix.yml')
    expect(bootstrap).toContain("git push -u origin agent/fix-failed-card-feedback-code")
  })
})
