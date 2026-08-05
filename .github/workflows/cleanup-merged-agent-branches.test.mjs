import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const workflowPath = fileURLToPath(new URL('./cleanup-merged-agent-branches.yml', import.meta.url))
const workflow = readFileSync(workflowPath, 'utf8')

describe('merged agent branch cleanup workflow', () => {
  it('only deletes agent branches backed by a merged PR and no open PR', () => {
    expect(workflow).toContain("if (!name.startsWith('agent/')) continue")
    expect(workflow).toContain("state: 'open'")
    expect(workflow).toContain('if (openPulls.length > 0)')
    expect(workflow).toContain("state: 'closed'")
    expect(workflow).toContain("base: 'main'")
    expect(workflow).toContain('closedPulls.some((pull) => Boolean(pull.merged_at))')
    expect(workflow).toContain('github.rest.git.deleteRef')
  })
})
