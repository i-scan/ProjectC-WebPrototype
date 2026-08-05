const inspectorLayoutCss = String.raw`
/* Runtime-authored after bundled styles so Vite CSS ordering cannot override it. */

body .visual-prototype.hex-prototype.inspector-hex > .visual-layout {
  grid-template-columns: 228px minmax(560px, 1fr) 360px !important;
}

body .visual-prototype.hex-prototype.inspector-thermal > .visual-layout {
  grid-template-columns: 228px minmax(470px, 1fr) 560px !important;
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
  --tc-body: 12px;
  --tc-label: 10px;
  --tc-small: 10px;
  --tc-title: 13px;
  --tc-value: 16px;
  --tc-value-emphasis: 20px;
  color: #dce9e7 !important;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  font-size: var(--tc-body) !important;
  font-synthesis: none !important;
  line-height: 1.45 !important;
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
  font-size: 11px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root p,
body .visual-prototype.hex-prototype .thermal-clock-inline-root label,
body .visual-prototype.hex-prototype .thermal-clock-inline-root summary,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-scenario-description,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-action-summary {
  font-size: 11px !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root small,
body .visual-prototype.hex-prototype .thermal-clock-inline-root code,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-config-meta,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-state-meta {
  font-size: var(--tc-small) !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-config-label > strong,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-section-heading strong,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-preview-header > div:first-child > strong {
  font-size: var(--tc-title) !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-state-value > span,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-section-heading span,
body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-clock-preview-steps > div span {
  font-size: var(--tc-label) !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-state-value > strong {
  font-size: var(--tc-value) !important;
}

body .visual-prototype.hex-prototype .thermal-clock-inline-root .thermal-lab-state-value.is-emphasis > strong {
  font-size: var(--tc-value-emphasis) !important;
}

@media (max-width: 1500px) and (min-width: 1321px) {
  body .visual-prototype.hex-prototype.inspector-hex > .visual-layout {
    grid-template-columns: 220px minmax(500px, 1fr) 345px !important;
  }

  body .visual-prototype.hex-prototype.inspector-thermal > .visual-layout {
    grid-template-columns: 220px minmax(430px, 1fr) 510px !important;
  }
}

@media (max-width: 1320px) and (min-width: 1181px) {
  body .visual-prototype.hex-prototype.inspector-hex > .visual-layout {
    grid-template-columns: 210px minmax(440px, 1fr) 330px !important;
  }

  body .visual-prototype.hex-prototype.inspector-thermal > .visual-layout {
    grid-template-columns: 210px minmax(390px, 1fr) 470px !important;
  }
}

@media (max-width: 1180px) {
  body .visual-prototype.hex-prototype > .visual-layout {
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
}
`

export function InspectorLayoutContract() {
  return (
    <style data-inspector-layout-contract="runtime-v2">
      {inspectorLayoutCss}
    </style>
  )
}
