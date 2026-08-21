from pathlib import Path

path = Path('scripts/verify-ut7-basic-move.mjs')
text = path.read_text()

marker = "    latestLog: root?.querySelector('.ut4-log-list article')?.textContent?.replace(/\\\\s+/g, ' ').trim() ?? '',\n"
addition = marker + "    playbackSegments: Number(root?.querySelector('.hex-travel-actor.player')?.dataset.playbackSegments ?? 0),\n    playbackPath: root?.querySelector('.hex-travel-actor.player')?.dataset.playbackPath ?? '',\n    playbackMotion: root?.querySelector('.hex-travel-actor.player animateMotion')?.getAttribute('path') ?? '',\n"
if 'playbackSegments: Number(' not in text:
    if marker not in text:
        raise SystemExit('snapshot latestLog marker missing')
    text = text.replace(marker, addition, 1)

old = "    if (!snapshot.header.includes('1.0 AT') || !snapshot.latestLog.includes('Basic Move') || !snapshot.latestLog.includes('Move2')) throw new Error(JSON.stringify(snapshot))\n"
new = "    const pathCells = snapshot.playbackPath ? snapshot.playbackPath.split('>') : []\n    const motionCommands = snapshot.playbackMotion.match(/\\\\b[ML]\\\\b/g) ?? []\n    if (!snapshot.header.includes('1.0 AT') || !snapshot.latestLog.includes('Basic Move') || !snapshot.latestLog.includes('Move2') || snapshot.playbackSegments !== 2 || pathCells.length !== 3 || motionCommands.length !== 3) throw new Error(JSON.stringify(snapshot))\n"
if 'snapshot.playbackSegments !== 2' not in text:
    if old not in text:
        raise SystemExit('afterOneMove assertion marker missing')
    text = text.replace(old, new, 1)

path.write_text(text)
