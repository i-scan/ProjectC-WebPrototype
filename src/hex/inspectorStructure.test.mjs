import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const hexPrototypePath = fileURLToPath(new URL('./HexPrototype.tsx', import.meta.url))
const thermalLabPath = fileURLToPath(new URL('./ThermalClockLab.tsx', import.meta.url))
const inspectorCssPath = fileURLToPath(new URL('./right-inspector.css', import.meta.url))
const inspectorContractPath = fileURLToPath(new URL('./right-inspector-contract.css', import.meta.url))
const observerPath = fileURLToPath(new URL('./RightInspectorChrome.tsx', import.meta.url))
const obsoleteCssPath = fileURLToPath(new URL('./thermal-clock-inspector.css', import.meta.url))
const browserVerificationPath = fileURLToPath(new URL('../../scripts/verify-browser-layout.mjs', import.meta.url))
const mainPath = fileURLToPath(new URL('../main.tsx', import.meta.url))

const hexPrototypeSource = readFileSync(hexPrototypePath, 'utf8')
const thermalLabSource = readFileSync(thermalLabPath, 'utf8')
const inspectorCssSource = readFileSync(inspectorCssPath, 'utf8')
const inspectorContractSource = readFileSync(inspectorContractPath, 'utf8')
const browserVerificationSource = readFileSync(browserVerificationPath, 'utf8')
const mainSource = readFileSync(mainPath, 'utf8')

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

  it('keeps the shared inspector width and Thermal type scale', () => {
    expect(inspectorCssSource).toContain('--inspector-right-width: 520px')
    expect(inspectorCssSource).toContain('--tc-body: 12px')
    expect(inspectorCssSource).toContain('--tc-value-emphasis: 20px')
    expect(inspectorCssSource).not.toContain('font-size: 6px')
  })

  it('loads the browser layout contract after the shared stylesheet', () => {
    const sharedImport = "import './hex/right-inspector.css'"
    const contractImport = "import './hex/right-inspector-contract.css'"

    expect(mainSource).toContain(sharedImport)
    expect(mainSource).toContain(contractImport)
    expect(mainSource.indexOf(contractImport)).toBeGreaterThan(mainSource.indexOf(sharedImport))
    expect(inspectorContractSource).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) max-content !important')
    expect(inspectorContractSource).toContain('--inspector-right-width: 560px')
    expect(inspectorContractSource).toContain('white-space: nowrap !important')
    expect(inspectorContractSource).toContain('font-family: inherit !important')
  })

  it('checks computed layout in a real browser instead of CSS text alone', () => {
    expect(browserVerificationSource).toContain("for (const width of [1920, 1366])")
    expect(browserVerificationSource).toContain('tab buttons are not on the same row')
    expect(browserVerificationSource).toContain('Thermal inspector did not become meaningfully wider')
    expect(browserVerificationSource).toContain("thermal.rootFontSize === '12px'")
  })

  it('does not restore obsolete DOM or CSS patch layers', () => {
    expect(existsSync(observerPath)).toBe(false)
    expect(existsSync(obsoleteCssPath)).toBe(false)
    expect(hexPrototypeSource).not.toContain('MutationObserver')
    expect(mainSource).not.toContain('thermal-clock-inspector.css')
  })
})
