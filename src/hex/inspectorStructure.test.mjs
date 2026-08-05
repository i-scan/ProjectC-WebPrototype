import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const hexPrototypePath = fileURLToPath(new URL('./HexPrototype.tsx', import.meta.url))
const thermalLabPath = fileURLToPath(new URL('./ThermalClockLab.tsx', import.meta.url))
const observerPath = fileURLToPath(new URL('./RightInspectorChrome.tsx', import.meta.url))

const hexPrototypeSource = readFileSync(hexPrototypePath, 'utf8')
const thermalLabSource = readFileSync(thermalLabPath, 'utf8')

describe('right inspector component boundaries', () => {
  it('keeps tab state, width mode, and coordinate in HexPrototype', () => {
    expect(hexPrototypeSource).toContain('inspector-${rightInspectorTab}')
    expect(hexPrototypeSource).toContain('className="hex-inspector-coordinate"')
    expect(hexPrototypeSource).toContain("rightInspectorTab === 'hex' ?")
    expect(hexPrototypeSource).not.toContain('<h3>Hex Inspector</h3>')
  })

  it('does not render the experiment header in embedded mode', () => {
    expect(thermalLabSource).toContain('{!embedded && (')
    expect(thermalLabSource).toContain('className="thermal-clock-config-label"')
  })

  it('does not restore the DOM observer bridge', () => {
    expect(existsSync(observerPath)).toBe(false)
    expect(hexPrototypeSource).not.toContain('MutationObserver')
  })
})
