from pathlib import Path


def replace_one(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'expected source block missing: {path}')
    p.write_text(text.replace(old, new, 1))


replace_one(
    'src/hex/HexThreeBoard.tsx',
    "import type { HexMode, TravelPreference } from './hexTravel'\n",
    "import type { HexMode, TravelPreference } from './hexTravel'\nimport { playbackSegmentAt, resolvedActorPlaybackPath } from './hexPlaybackPath'\n",
)

replace_one(
    'src/hex/HexThreeBoard.tsx',
    "type MoveAnimation = { object: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; startedAt: number; duration: number; arcHeight: number }",
    """type MoveAnimation = {
  object: THREE.Object3D
  waypoints: THREE.Vector3[]
  startedAt: number
  duration: number
  arcHeight: number
}""",
)

replace_one(
    'src/hex/HexThreeBoard.tsx',
    """      moveRef.current = moveRef.current.filter((item) => {
        const progress = clamp((now - item.startedAt) / item.duration, 0, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        item.object.position.lerpVectors(item.from, item.to, eased)
        item.object.position.y += Math.sin(progress * Math.PI) * item.arcHeight
        return progress < 1
      })""",
    """      moveRef.current = moveRef.current.filter((item) => {
        const progress = clamp((now - item.startedAt) / item.duration, 0, 1)
        const segment = playbackSegmentAt(progress, item.waypoints.length)
        const from = item.waypoints[segment.segmentIndex]
        const to = item.waypoints[segment.segmentIndex + 1] ?? from
        const eased = 1 - Math.pow(1 - segment.localProgress, 3)
        item.object.position.lerpVectors(from, to, eased)
        item.object.position.y += Math.sin(segment.localProgress * Math.PI) * item.arcHeight
        host.dataset.movePlaybackSegment = String(segment.segmentIndex + 1)
        host.dataset.movePlaybackSegments = String(segment.segmentCount)
        host.dataset.movePlaybackCompleted = progress >= 1 ? 'true' : 'false'
        return progress < 1
      })""",
)

replace_one(
    'src/hex/HexThreeBoard.tsx',
    """        const from = hexWorldPosition(previous, state, 0.1)
        pawn.position.copy(from)
        const momentumLog = state.logs.find((log) => log.includes('[UT3] Rush Strike'))
          ?? state.logs.find((log) => log.includes('[UT3] Drive'))
          ?? ''
        const isLaunch = momentumLog.includes('Launch') && actor.id !== 'player'
        const isBounce = momentumLog.includes('Bounce') && actor.id !== 'player'
        const isPierce = momentumLog.includes('Pierce') && actor.id === 'player'
        const isPush = momentumLog.includes('Push') && actor.id !== 'player'
        moveRef.current.push({
          object: pawn,
          from,
          to: target,
          startedAt: performance.now(),
          duration: Math.max(120, Math.min(eventDurationMs * 0.84, isPierce ? 280 : isLaunch || isBounce ? 620 : isPush ? 360 : 430)),
          arcHeight: isLaunch ? 0.92 : isBounce ? 0.42 : isPierce ? 0.08 : isPush ? 0.04 : 0.18,
        })""",
    """        const playbackCoords = resolvedActorPlaybackPath(previous, actor.position, event, actor.id)
        const waypoints = playbackCoords.map((coord) => hexWorldPosition(coord, state, 0.1))
        const from = waypoints[0]
        pawn.position.copy(from)
        const momentumLog = state.logs.find((log) => log.includes('[UT3] Rush Strike'))
          ?? state.logs.find((log) => log.includes('[UT3] Drive'))
          ?? ''
        const isLaunch = momentumLog.includes('Launch') && actor.id !== 'player'
        const isBounce = momentumLog.includes('Bounce') && actor.id !== 'player'
        const isPierce = momentumLog.includes('Pierce') && actor.id === 'player'
        const isPush = momentumLog.includes('Push') && actor.id !== 'player'
        const segmentCount = Math.max(1, waypoints.length - 1)
        const perSegmentDuration = Math.max(120, Math.min(eventDurationMs * 0.84, isPierce ? 280 : isLaunch || isBounce ? 620 : isPush ? 360 : 430))
        moveRef.current.push({
          object: pawn,
          waypoints,
          startedAt: performance.now(),
          duration: perSegmentDuration * segmentCount,
          arcHeight: isLaunch ? 0.92 : isBounce ? 0.42 : isPierce ? 0.08 : isPush ? 0.04 : 0.18,
        })
        if (hostRef.current && event?.effect === 'move' && event.actorId === actor.id) {
          hostRef.current.dataset.movePlaybackPath = playbackCoords.map(coordKey).join('>')
          hostRef.current.dataset.movePlaybackSegments = String(segmentCount)
          hostRef.current.dataset.movePlaybackCompleted = 'false'
        }""",
)

replace_one(
    'src/hex/HexThreeBoard.tsx',
    "new THREE.BufferGeometry().setFromPoints([from.clone().setY(0.22), target.clone().setY(0.22)]),",
    "new THREE.BufferGeometry().setFromPoints(waypoints.map((point) => point.clone().setY(0.22))),",
)

replace_one(
    'src/hex/HexThreeBoard.tsx',
    """        const momentumDirection = selection.kind === 'momentum' ? hexDirectionOnLine(player.position, hoverCoord) : null
        const pathCoords = selection.kind === 'momentum' && momentumDirection
          ? [player.position, ...hexRay(player.position, momentumDirection, hexDistance(player.position, hoverCoord))]
          : buildHexPath(state, player.position, hoverCoord, 8, player.id)""",
    """        const momentumDirection = selection.kind === 'momentum' ? hexDirectionOnLine(player.position, hoverCoord) : null
        const routedPath = selection.kind === 'momentum' && selection.route && selection.route.length > 0
          ? (sameCoord(selection.route[0], player.position) ? selection.route : [player.position, ...selection.route])
          : undefined
        const pathCoords = routedPath
          ?? (selection.kind === 'momentum' && momentumDirection
            ? [player.position, ...hexRay(player.position, momentumDirection, hexDistance(player.position, hoverCoord))]
            : buildHexPath(state, player.position, hoverCoord, 8, player.id))""",
)

replace_one(
    'src/hex/HexThreeBoard.tsx',
    """    if (travelPath.length > 1) {
      const points = travelPath.map((coord) => hexWorldPosition(coord, state, 0.2))""",
    """    if (travelPath.length > 0) {
      const normalizedTravelPath = sameCoord(travelPath[0], player.position) ? travelPath : [player.position, ...travelPath]
      const points = normalizedTravelPath.map((coord) => hexWorldPosition(coord, state, 0.2))""",
)

replace_one(
    'src/hex/HexTravelMap.tsx',
    "import type { PlaybackEvent } from '../visual/visualPlayback'\n",
    "import type { PlaybackEvent } from '../visual/visualPlayback'\nimport { eventActorPlaybackPath } from './hexPlaybackPath'\n",
)

replace_one(
    'src/hex/HexTravelMap.tsx',
    """            const center = hexCenter(actor.position)
            const momentum = Math.max(0, Math.min(3, Math.floor(momentumByActorId[actor.id] ?? 0)))
            const launched = event?.actorId === actor.id && event.label?.includes('Launch')
            return (
              <g key={actor.id} className={`hex-travel-actor ${actor.faction} ${launched ? 'launching' : ''}`}>""",
    """            const center = hexCenter(actor.position)
            const momentum = Math.max(0, Math.min(3, Math.floor(momentumByActorId[actor.id] ?? 0)))
            const launched = event?.actorId === actor.id && event.label?.includes('Launch')
            const rawPlaybackPath = eventActorPlaybackPath(actor.position, event, actor.id)
            const playbackPath = rawPlaybackPath && rawPlaybackPath.length > 0
              ? rawPlaybackPath
              : undefined
            const playbackSegments = Math.max(0, playbackPath?.length ?? 0)
            const motionPath = playbackPath?.map((coord, index) => {
              const waypoint = hexCenter(coord)
              return `${index === 0 ? 'M' : 'L'} ${waypoint.x - center.x} ${waypoint.y - center.y}`
            }).join(' ') ?? ''
            return (
              <g
                key={actor.id}
                className={`hex-travel-actor ${actor.faction} ${launched ? 'launching' : ''}`}
                data-playback-segments={playbackSegments}
                data-playback-path={playbackPath?.map(keyOf).join('>') ?? ''}
              >
                {motionPath && playbackSegments > 1 && (
                  <animateMotion key={`${event?.id ?? 0}-${actor.id}`} dur={`${Math.max(0.22, (playbackSegments - 1) * 0.42)}s`} path={motionPath} fill="freeze" calcMode="linear" />
                )}""",
)

replace_one(
    'src/hex/ActorLoopUt7BasicMovePlayground.tsx',
    "label: `${plan.label} · ${plan.atCost} AT`, durationAt: Math.max(0.5, plan.atCost), path: plan.path.map((coord) => ({ ...coord })),",
    "label: `${plan.label} · ${plan.atCost} AT`, durationAt: Math.max(0.5, plan.atCost), path: [{ ...beforePlayer.position }, ...plan.path.map((coord) => ({ ...coord }))],",
)

replace_one(
    'src/hex/ActorLoopUt7BasicMovePlayground.tsx',
    "  const previewPath = preview?.path ?? []",
    "  const previewPath = preview?.path.length ? [{ ...player.position }, ...preview.path.map((coord) => ({ ...coord }))] : []",
)

replace_one(
    'scripts/verify-ut7-basic-move.mjs',
    """    radius: Number(radiusInput?.value ?? 0),
    latestLog: root?.querySelector('.ut4-log-list article')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
  }""",
    """    radius: Number(radiusInput?.value ?? 0),
    latestLog: root?.querySelector('.ut4-log-list article')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
    playbackSegments: Number(root?.querySelector('.hex-travel-actor.player')?.dataset.playbackSegments ?? 0),
    playbackPath: root?.querySelector('.hex-travel-actor.player')?.dataset.playbackPath ?? '',
    playbackMotion: root?.querySelector('.hex-travel-actor.player animateMotion')?.getAttribute('path') ?? '',
  }""",
)

replace_one(
    'scripts/verify-ut7-basic-move.mjs',
    """  const afterOneMove = await waitFor('UT7 one Basic Move command with inertia path', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    if (!snapshot.header.includes('1.0 AT') || !snapshot.latestLog.includes('Basic Move') || !snapshot.latestLog.includes('Move2')) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })""",
    """  const afterOneMove = await waitFor('UT7 one Basic Move command with inertia path', async () => {
    const snapshot = await evaluate(client, snapshotExpression)
    const pathCells = snapshot.playbackPath ? snapshot.playbackPath.split('>') : []
    const motionCommands = snapshot.playbackMotion.match(/\\b[ML]\\b/g) ?? []
    if (!snapshot.header.includes('1.0 AT') || !snapshot.latestLog.includes('Basic Move') || !snapshot.latestLog.includes('Move2') || snapshot.playbackSegments !== 3 || pathCells.length !== 3 || motionCommands.length !== 3) throw new Error(JSON.stringify(snapshot))
    return snapshot
  })""",
)
