import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const verifierPath = fileURLToPath(new URL('./verify-deployment.mjs', import.meta.url))
const verifierSource = readFileSync(verifierPath, 'utf8')

describe('Pages deployment verifier source contract', () => {
  it('uses a fresh cache-bust value for every retry attempt', () => {
    expect(verifierSource).toContain('return await operation(attempt)')
    expect(verifierSource).toContain("requestUrl.searchParams.set(")
    expect(verifierSource).toContain('${expectedCommit}-${label}-${attempt}-${Date.now()}')
    expect(verifierSource).not.toContain('const cacheBust =')
  })

  it('allows Pages and CDN propagation longer than the former 90-second window', () => {
    expect(verifierSource).toContain("DEPLOY_VERIFY_ATTEMPTS || '60'")
    expect(verifierSource).toContain("DEPLOY_VERIFY_DELAY_MS || '5000'")
    expect(verifierSource).not.toContain('attempt <= 18')
  })

  it('retries HTML, JavaScript and stylesheet publication independently', () => {
    expect(verifierSource).toContain("await retry('revision page'")
    expect(verifierSource).toContain("await retry('published JavaScript bundle'")
    expect(verifierSource).toContain("await retry('published stylesheet'")
  })
})
