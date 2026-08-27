export const MOTION_TRACE_DEBUG_BRIDGE = 'motion-trace-debug-bridge-v1'

function latestTraceEvent(events, actorId) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.kind === 'motion-trace' && event.actorId === actorId) return event
  }
  return null
}

function install() {
  const api = window.__PROJECTC_PROTOTYPE__
  if (!api || api.__motionTraceBridge === MOTION_TRACE_DEBUG_BRIDGE) return

  Object.defineProperties(api, {
    __motionTraceBridge: {
      value: MOTION_TRACE_DEBUG_BRIDGE,
      enumerable: true,
      configurable: true,
    },
    motionTrace: {
      value(actorId = 'player') {
        const events = api.conflicts?.() ?? []
        const event = latestTraceEvent(events, String(actorId))
        return structuredClone(event?.trace ?? [])
      },
      enumerable: true,
      configurable: true,
    },
    motionTraces: {
      value() {
        const events = api.conflicts?.() ?? []
        const result = {}
        for (const event of events) {
          if (event?.kind !== 'motion-trace' || !event.actorId) continue
          result[event.actorId] = structuredClone(event.trace ?? [])
        }
        return result
      },
      enumerable: true,
      configurable: true,
    },
  })
}

install()
const timer = window.setInterval(install, 25)
window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true })
