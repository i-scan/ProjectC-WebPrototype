const inspectorLayoutCss = String.raw`
/* Runtime-authored after bundled styles so Vite CSS ordering cannot override it. */

body .visual-prototype.hex-prototype.inspector-hex > .visual-layout,
body .visual-prototype.hex-prototype.inspector-thermal > .visual-layout {
  grid-template-columns: 228px minmax(510px, 1fr) 460px !important;
}

body .visual-prototype.hex-prototype .visual-layout > .visual-right-panel {
  min-width: 0 !important;
  width: 100% !important;
  max-width: none !important;
}

body .visual-prototype.hex-prototype .visual-layout > .visual-right-panel > .hex-inspector-tabs {
  width: 100% !important;
  min-width: 0 !important;
  height: 46px !important;
  min-height: 46px !important;
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) max-content !important;
  grid-template-rows: 36px !important;
  grid-auto-flow: column !important;
  align-items: stretch !important;
  gap: 6px !important;
  padding: 5px !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
}

body .visual-prototype.hex-prototype .visual-layout > .visual-right-panel > .hex-inspector-tabs > button {
  min-width: 0 !important;
  width: 100% !important;
  max-width: 100% !important;
  height: 36px !important;
  min-height: 36px !important;
  display: block !important;
  padding: 8px 7px !important;
  overflow: hidden !important;
  font-size: 11px !important;
  font-weight: 720 !important;
  line-height: 18px !important;
  overflow-wrap: normal !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  word-break: keep-all !important;
  box-sizing: border-box !important;
}

body .visual-prototype.hex-prototype .visual-layout > .visual-right-panel > .hex-inspector-tabs > .hex-inspector-coordinate {
  min-width: 0 !important;
  width: auto !important;
  max-width: 88px !important;
  height: 36px !important;
  grid-column: auto !important;
  align-self: stretch !important;
  display: flex !important;
  align-items: center !important;
  justify-content: flex-end !important;
  padding: 0 2px !important;
  overflow: hidden !important;
  font-size: 8px !important;
  line-height: 1.2 !important;
  text-align: right !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  box-sizing: border-box !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root {
  --tc-body: 10px;
  --tc-label: 8px;
  --tc-small: 8px;
  --tc-title: 10px;
  --tc-value: 12px;
  --tc-value-emphasis: 14px;
  color: #dce9e7 !important;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  font-size: var(--tc-body) !important;
  font-synthesis: none !important;
  line-height: 1.35 !important;
  text-rendering: optimizeLegibility !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root,
body .visual-prototype.hex-prototype .thermal-clock-inline-root * {
  box-sizing: border-box !important;
  font-family: inherit !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root button,
body .visual-prototype.hex-prototype .thermal-clock-inline-root select,
body .visual-prototype.hex-prototype .thermal-clock-inline-root output {
  font-size: 10px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root p,
body .visual-prototype.hex-prototype .thermal-clock-inline-root label,
body .visual-prototype.hex-prototype .thermal-clock-inline-root summary,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-scenario-description,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-action-summary {
  font-size: 9px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root small,
body .visual-prototype.hex-prototype .thermal-clock-inline-root code,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-config-meta,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-state-meta {
  font-size: var(--tc-small) !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-setup {
  gap: 6px !important;
  padding: 0 0 10px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-config-control {
  gap: 5px !important;
  padding: 8px !important;
  border-radius: 8px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-config-label {
  gap: 2px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-config-label > strong,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-section-heading strong,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-preview-header > div:first-child > strong {
  font-size: var(--tc-title) !important;
  line-height: 1.25 !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-config-label > small {
  display: block !important;
  overflow: hidden !important;
  font-size: var(--tc-small) !important;
  line-height: 1.25 !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-setup select {
  min-height: 32px !important;
  padding: 5px 28px 5px 8px !important;
  border-radius: 6px !important;
  font-size: 10px !important;
  line-height: 1.2 !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-config-meta {
  overflow: hidden !important;
  line-height: 1.25 !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-scenario-description {
  display: -webkit-box !important;
  margin: 0 !important;
  padding: 6px 8px !important;
  overflow: hidden !important;
  font-size: 9px !important;
  line-height: 1.35 !important;
  -webkit-box-orient: vertical !important;
  -webkit-line-clamp: 2 !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-overview {
  padding: 10px 0 8px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-overview .thermal-lab-state-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
  gap: 5px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-state-value {
  min-height: 48px !important;
  gap: 2px !important;
  padding: 7px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-state-value > span,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-section-heading span,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-preview-header > div:first-child > span,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-preview-steps > div span {
  font-size: var(--tc-label) !important;
  line-height: 1.2 !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-state-value > strong {
  margin-top: 1px !important;
  font-size: var(--tc-value) !important;
  line-height: 1.15 !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-state-value.is-emphasis > strong {
  font-size: var(--tc-value-emphasis) !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-state-meta {
  margin: 6px 0 0 !important;
  overflow: hidden !important;
  line-height: 1.3 !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-phase-card {
  padding: 9px 0 !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-section-heading,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-preview-header {
  gap: 8px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-section-heading > small,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-period-explanation,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-phase-axis > div {
  font-size: var(--tc-small) !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-period-explanation {
  margin: 4px 0 7px !important;
  line-height: 1.35 !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-advanced-state > summary,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-advanced-actions > summary,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-log > summary {
  min-height: 32px !important;
  padding: 7px 9px !important;
  font-size: 9px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-diagnostic-grid {
  gap: 5px !important;
  padding: 7px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-diagnostic-grid .thermal-lab-state-value {
  min-height: 42px !important;
  padding: 6px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-range {
  grid-template-columns: 76px minmax(0, 1fr) 38px !important;
  gap: 6px !important;
  padding: 6px 8px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-range > span,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-range > output {
  font-size: var(--tc-small) !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-actions {
  padding: 10px 0 9px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-action-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  gap: 6px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-action-grid > button {
  height: 62px !important;
  min-height: 62px !important;
  max-height: 62px !important;
  gap: 2px !important;
  padding: 7px 8px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-action-grid > button > strong {
  font-size: 11px !important;
  line-height: 1.15 !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-action-grid > button > span {
  display: block !important;
  overflow: hidden !important;
  font-size: 9px !important;
  line-height: 1.2 !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-action-grid > button > small {
  font-size: var(--tc-small) !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-advanced-actions {
  margin-top: 6px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-preview {
  padding: 10px 0 !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-event-summary,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-event-summary span {
  font-size: var(--tc-small) !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-event-summary {
  min-width: 96px !important;
  line-height: 18px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-action-summary {
  min-height: 26px !important;
  margin: 7px 0 0 !important;
  padding: 6px 8px !important;
  font-size: var(--tc-small) !important;
  line-height: 1.3 !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-preview-steps {
  gap: 5px !important;
  margin-top: 8px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-preview-steps > div {
  min-height: 54px !important;
  padding: 7px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-preview-steps > div b {
  font-size: 11px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-preview-steps > div small,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-result-metrics span {
  font-size: var(--tc-small) !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-result-metrics span {
  padding: 6px 4px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-resolve {
  min-height: 34px !important;
  margin-top: 8px !important;
  font-size: 10px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-toolbar {
  gap: 5px !important;
  padding: 0 0 9px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-toolbar button {
  min-height: 32px !important;
  padding: 6px !important;
  font-size: 9px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-log-body,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-empty,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-log li,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-log code,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-log small {
  font-size: var(--tc-small) !important;
  line-height: 1.35 !important;
}

@media (max-width: 1500px) and (min-width: 1321px) {
  body .visual-prototype.hex-prototype.inspector-hex > .visual-layout,
  body .visual-prototype.hex-prototype.inspector-thermal > .visual-layout {
    grid-template-columns: 220px minmax(470px, 1fr) 430px !important;
  }
}

@media (max-width: 1320px) and (min-width: 1181px) {
  body .visual-prototype.hex-prototype.inspector-hex > .visual-layout,
  body .visual-prototype.hex-prototype.inspector-thermal > .visual-layout {
    grid-template-columns: 210px minmax(420px, 1fr) 400px !important;
  }
}

@media (max-width: 1180px) {
  body .visual-prototype.hex-prototype.inspector-hex > .visual-layout,
  body .visual-prototype.hex-prototype.inspector-thermal > .visual-layout {
    grid-template-columns: 210px minmax(0, 1fr) !important;
  }

  body .visual-prototype.hex-prototype .visual-layout > .visual-right-panel {
    grid-column: 1 / -1 !important;
  }
}

@media (max-width: 760px) {
  body .visual-prototype.hex-prototype .visual-layout > .visual-right-panel > .hex-inspector-tabs {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
  }

  body .visual-prototype.hex-prototype .visual-layout > .visual-right-panel > .hex-inspector-tabs > .hex-inspector-coordinate {
    display: none !important;
  }

  body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-setup,
  body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-overview .thermal-lab-state-grid,
  body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-action-grid {
    grid-template-columns: 1fr !important;
  }
}
`

export function InspectorLayoutContract() {
  return (
    <style data-inspector-layout-contract="runtime-v3">
      {inspectorLayoutCss}
    </style>
  )
}
