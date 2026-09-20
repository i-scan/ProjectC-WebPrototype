// Presentation reads semantic events, never selected card/action ids.
const styles = {
  Collision: { label: 'COLLISION', color: 0xff9855, style: 'ring' },
  AttackPayload: { label: 'ATTACK', color: 0xff648c, style: 'slash' },
  ImpactPayload: { label: 'IMPACT', color: 0xffffff, style: 'ring' },
  Clash: { label: 'CLASH · HOOK', color: 0xffe06a, style: 'cross' },
  DownResistance: { label: 'RESIST', color: 0x6abfff, style: 'shield' },
  ForcedMotion: { label: 'FORCED', color: 0xc89cff, style: 'arrow' },
  SurfaceReflection: { label: 'REFLECT', color: 0x62dff2, style: 'cross' },
}

export function encounterFxSpecs(events = []) {
  return events.filter((event) => styles[event.type] && event.hex)
    .map((event) => ({ ...styles[event.type], hex: event.hex, t: event.t, axisId: event.axisId, eventId: event.id }))
}
