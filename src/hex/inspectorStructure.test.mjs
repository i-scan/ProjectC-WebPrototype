import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const hexPrototypePath = fileURLToPath(new URL('./HexPrototype.tsx', import.meta.url))
const actorLoopPath = fileURLToPath(new URL('./ActorLoopPlayground.tsx', import.meta.url))
const ut7Path = fileURLToPath(new URL('./ActorLoopUt7Playground.tsx', import.meta.url))
const thermalLabPath = fileURLToPath(new URL('./ThermalClockLab.tsx', import.meta.url))
const inspectorCssPath = fileURLToPath(new URL('./right-inspector.css', import.meta.url))
const runtimeContractPath = fileURLToPath(new URL('./InspectorLayoutContract.tsx', import.meta.url))
const observerPath = fileURLToPath(new URL('./RightInspectorChrome.tsx', import.meta.url))
const obsoleteCssPath = fileURLToPath(new URL('./thermal-clock-inspector.css', import.meta.url))
const browserVerificationPath = fileURLToPath(new URL('../../scripts/verify-browser-layout.mjs', import.meta.url))
const mainPath = fileURLToPath(new URL('../main.tsx', import.meta.url))

const hexPrototypeSource = readFileSync(hexPrototypePath, 'utf8')
const actorLoopSource = readFileSync(actorLoopPath, 'utf8')
const ut7Source = readFileSync(ut7Path, 'utf8')
const thermalLabSource = readFileSync(thermalLabPath, 'utf8')
const inspectorCssSource = readFileSync(inspectorCssPath, 'utf8')
const runtimeContractSource = readFileSync(runtimeContractPath, 'utf8')
const browserVerificationSource = readFileSync(browserVerificationPath, 'utf8')
const mainSource = readFileSync(mainPath, 'utf8')

describe('right inspector component boundaries', () => {
  it('keeps historical tab state, width mode, and coordinate in HexPrototype', () => {
    expect(hexPrototypeSource).toContain('inspector-${rightInspectorTab}')
    expect(hexPrototypeSource).toContain('className="hex-inspector-coordinate"')
    expect(hexPrototypeSource).toContain("rightInspectorTab === 'hex' ?")
    expect(hexPrototypeSource).not.toContain('<h3>Hex Inspector</h3>')
  })

  it('does not render the experiment header in embedded mode', () => {
    expect(thermalLabSource).toContain('{!embedded && (')
    expect(thermalLabSource).toContain('className="thermal-clock-config-label"')
  })

  it('keeps shared inspector styling available as the non-runtime fallback', () => {
    expect(inspectorCssSource).toContain('.hex-prototype.inspector-hex')
    expect(inspectorCssSource).toContain('.hex-prototype.inspector-thermal')
    expect(inspectorCssSource).not.toContain('font-size: 6px')
  })

  it('keeps the stable-width inspector contract on the hidden historical Hex route only', () => {
    expect(mainSource).toContain("import { InspectorLayoutContract } from './hex/InspectorLayoutContract'")
    expect(mainSource).toContain("{view === 'hex-legacy' && <InspectorLayoutContract />}")
    expect(mainSource).toContain("{view === 'hex' && <ActorLoopUt7Playground />}")
    expect(mainSource).toContain("{view === 'hex-ut6' && <ActorLoopPlayground />}")
    expect(actorLoopSource).toContain('VAL-012-UT6-candidate')
    expect(ut7Source).toContain('VAL-012-UT7-candidate')
    expect(mainSource).not.toContain("{view === 'hex' && <InspectorLayoutContract />}")
    expect(mainSource).not.toContain("{view === 'hex-ut6' && <InspectorLayoutContract />}")
    expect(mainSource).not.toContain("import './hex/right-inspector-contract.css'")
    expect(runtimeContractSource).toContain('data-inspector-layout-contract="runtime-v3"')
    expect(runtimeContractSource).toContain('.inspector-hex > .visual-layout,')
    expect(runtimeContractSource).toContain('.inspector-thermal > .visual-layout')
    expect(runtimeContractSource).toContain('grid-template-columns: 228px minmax(510px, 1fr) 460px !important')
    expect(runtimeContractSource).toContain('grid-template-columns: 220px minmax(470px, 1fr) 430px !important')
    expect(runtimeContractSource).toContain('white-space: nowrap !important')
  })

  it('uses a compact Thermal hierarchy close to the historical Hex inspector scale', () => {
    expect(runtimeContractSource).toContain('--tc-body: 10px')
    expect(runtimeContractSource).toContain('--tc-title: 10px')
    expect(runtimeContractSource).toContain('--tc-value: 12px')
    expect(runtimeContractSource).toContain('--tc-value-emphasis: 14px')
    expect(runtimeContractSource).toContain('grid-template-columns: repeat(2, minmax(0, 1fr)) !important')
    expect(runtimeContractSource).not.toContain('--tc-value-emphasis: 20px')
  })

  it('checks computed stable width and typography in the historical Hex browser contract', () => {
    expect(browserVerificationSource).toContain('for (const width of [1920, 1366])')
    expect(browserVerificationSource).toContain('tab buttons are not on the same row')
    expect(browserVerificationSource).toContain('inspector width changes when switching tabs')
    expect(browserVerificationSource).toContain("thermal.rootFontSize === '10px'")
    expect(browserVerificationSource).toContain('Math.max(...fontSizes) <= 14')
  })

  it('does not restore obsolete DOM or CSS patch layers', () => {
    expect(existsSync(observerPath)).toBe(false)
    expect(existsSync(obsoleteCssPath)).toBe(false)
    expect(hexPrototypeSource).not.toContain('MutationObserver')
    expect(mainSource).not.toContain('thermal-clock-inspector.css')
  })
})
