import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const workflowPath = fileURLToPath(new URL('./report-pages-deployment-status.yml', import.meta.url))
const workflow = readFileSync(workflowPath, 'utf8')

describe('Pages deployment status reporting', () => {
  it('reports completed main Pages workflows on the source commit', () => {
    expect(workflow).toContain('workflow_run:')
    expect(workflow).toContain('- Deploy GitHub Pages')
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'")
    expect(workflow).toContain('statuses: write')
    expect(workflow).toContain("context: 'pages/verified-deployment'")
    expect(workflow).toContain('sha: run.head_sha')
    expect(workflow).toContain('target_url: run.html_url')
  })

  it('reports only a fully successful Pages workflow as success', () => {
    expect(workflow).toContain("conclusion === 'success'")
    expect(workflow).toContain("? 'success'")
    expect(workflow).toContain("? 'failure'")
    expect(workflow).toContain(": 'error'")
  })
})
