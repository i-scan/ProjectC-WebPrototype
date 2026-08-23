const AXIS_ANGLES = Object.freeze({ E: 0, NE: -60, NW: -120, W: 180, SW: 120, SE: 60 })

function displayState({ axisId, momentum, spatialMode, velocity, override }) {
  if (override?.startsWith('down-')) {
    return { kind: 'down', axisLabel: 'Down', level: Number(override.split('-')[1]) || 1, angle: 90 }
  }
  if (override === 'm0') {
    return { kind: axisId ? 'horizontal' : 'none', axisLabel: axisId ?? 'None', level: 0, angle: AXIS_ANGLES[axisId] ?? 0 }
  }
  if (spatialMode === 'hybrid') {
    const speed = Math.hypot(velocity?.x ?? 0, velocity?.z ?? 0)
    if (speed < 0.02) return { kind: 'none', axisLabel: 'None', level: 0, angle: 0 }
    const angle = Math.atan2(velocity.z, velocity.x) * 180 / Math.PI
    return { kind: 'horizontal', axisLabel: `${((angle % 360) + 360) % 360}`.replace(/\.0$/, ''), level: momentum, angle }
  }
  return {
    kind: axisId ? 'horizontal' : 'none',
    axisLabel: axisId ?? 'None',
    level: momentum,
    angle: AXIS_ANGLES[axisId] ?? 0,
  }
}

export function UnifiedAxisHud({
  axisId,
  momentum,
  spatialMode,
  velocity,
  override = 'auto',
  turnRadius = 0,
  range = 1,
  reachableCount = 0,
}) {
  const display = displayState({ axisId, momentum, spatialMode, velocity, override })
  const activeDots = Math.max(0, Math.min(3, Math.round(display.level)))
  return (
    <>
      <style>{`
        .legacy-axis-hud{display:none!important}
        .unified-axis-hud{position:absolute;right:14px;top:14px;z-index:34;width:154px;padding:10px 11px;border:1px solid rgba(242,200,90,.38);border-radius:10px;background:rgba(17,27,39,.88);box-shadow:0 6px 24px rgba(0,0,0,.24);pointer-events:none;color:#dce7ef;font:600 11px/1.25 system-ui,sans-serif;backdrop-filter:blur(5px)}
        .unified-axis-hud__head{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;text-transform:uppercase;letter-spacing:.08em;color:#9fb0bf}
        .unified-axis-hud__head b{font-size:13px;color:#f2c85a;letter-spacing:.02em}
        .unified-axis-hud svg{display:block;width:100%;height:62px;overflow:visible}
        .unified-axis-hud__line{stroke:#f2c85a;stroke-width:3;stroke-linecap:round}
        .unified-axis-hud__head-shape{fill:#f2c85a}
        .unified-axis-hud__origin{fill:#172434;stroke:#f2c85a;stroke-width:2}
        .unified-axis-hud__dot{fill:#334151;stroke:#778492;stroke-width:1}
        .unified-axis-hud__dot.is-active{fill:#cf82e3;stroke:#e8baf2}
        .unified-axis-hud__none{fill:none;stroke:#aebcc9;stroke-width:2;stroke-dasharray:4 3}
        .unified-axis-hud__facts{display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;color:#9fb0bf}
        .unified-axis-hud__facts b{color:#e7edf3;font-weight:700}
      `}</style>
      <div
        className="unified-axis-hud"
        data-axis-ui="unified-v2"
        data-axis-kind={display.kind}
        data-axis-id={display.axisLabel}
        data-axis-level={activeDots}
        data-turn-radius={turnRadius}
        data-range={range}
        data-reachable-count={reachableCount}
      >
        <div className="unified-axis-hud__head"><span>Axis</span><b>{display.axisLabel} · M{activeDots}</b></div>
        <svg viewBox="0 0 132 62" aria-label={`Axis ${display.axisLabel}, Momentum M${activeDots}`}>
          {display.kind === 'none' ? (
            <g transform="translate(66 30)">
              <circle className="unified-axis-hud__none" r="13" />
              <path className="unified-axis-hud__none" d="M -6 0 L 6 0" />
            </g>
          ) : (
            <g transform={`translate(66 30) rotate(${display.angle})`}>
              <line className="unified-axis-hud__line" x1="-20" y1="0" x2="26" y2="0" />
              <path className="unified-axis-hud__head-shape" d="M 34 0 L 23 -7 L 23 7 Z" />
              <circle className="unified-axis-hud__origin" cx="-23" cy="0" r="5" />
            </g>
          )}
          {[0, 1, 2].map((index) => (
            <circle key={index} className={`unified-axis-hud__dot${index < activeDots ? ' is-active' : ''}`} cx={50 + index * 16} cy="56" r="4" />
          ))}
        </svg>
        <div className="unified-axis-hud__facts">
          <span>Range <b>{range}</b></span>
          <span>Turn R <b>{turnRadius}</b></span>
          <span>Reach <b>{reachableCount}</b></span>
          <span>Mode <b>{display.kind === 'down' ? 'Down' : spatialMode === 'discrete' ? 'Hex6' : 'P/V'}</b></span>
        </div>
      </div>
    </>
  )
}
