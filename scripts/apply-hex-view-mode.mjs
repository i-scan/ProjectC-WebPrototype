import fs from 'node:fs'

function replaceRequired(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`Missing patch target: ${label}`)
  return text.replace(before, after)
}

const prototypePath = 'src/hex/HexPrototype.tsx'
let prototype = fs.readFileSync(prototypePath, 'utf8')

prototype = replaceRequired(
  prototype,
  "import './hex-travel.css'",
  "import './hex-travel.css'\nimport './hex-view-mode.css'",
  'HexPrototype css import',
)
prototype = replaceRequired(
  prototype,
  "const maxUndoSteps = 120",
  "const maxUndoSteps = 120\ntype HexRenderer = '2d' | '3d'",
  'HexPrototype renderer type',
)
prototype = replaceRequired(
  prototype,
  "  const [mode, setMode] = useState<HexMode>('travel')\n  const [selection, setSelection]",
  "  const [mode, setMode] = useState<HexMode>('travel')\n  const [rendererMode, setRendererMode] = useState<HexRenderer>('3d')\n  const [selection, setSelection]",
  'HexPrototype renderer state',
)
prototype = replaceRequired(
  prototype,
  `        <div className="hex-mode-switch" role="tablist" aria-label="地图操作模式">
          <button className={mode === 'travel' ? 'active' : ''} onClick={() => mode === 'travel' ? undefined : resumeTravel()}>旅行 Travel</button>
          <button className={mode === 'tactical' ? 'active' : ''} onClick={() => mode === 'tactical' ? undefined : enterTactical()}>战术 Tactical</button>
        </div>
        <div className="visual-turn-strip">`,
  `        <div className="hex-mode-switch" role="tablist" aria-label="地图操作模式">
          <button className={mode === 'travel' ? 'active' : ''} onClick={() => mode === 'travel' ? undefined : resumeTravel()}>旅行 Travel</button>
          <button className={mode === 'tactical' ? 'active' : ''} onClick={() => mode === 'tactical' ? undefined : enterTactical()}>战术 Tactical</button>
        </div>
        <div className="hex-view-switch" role="tablist" aria-label="地图表现方式">
          <button className={rendererMode === '2d' ? 'active' : ''} onClick={() => { setRendererMode('2d'); setHoverCoord(undefined) }}>2D</button>
          <button className={rendererMode === '3d' ? 'active' : ''} onClick={() => { setRendererMode('3d'); setHoverCoord(undefined) }}>3D</button>
        </div>
        <div className="visual-turn-strip">`,
  'HexPrototype header switches',
)
prototype = replaceRequired(
  prototype,
  `              <button onClick={() => setCameraResetToken((value) => value + 1)}>重置视图</button>
              <span>{mode === 'travel' ? '点击任意可通行 Hex 规划路径；黄色为最快，绿色为安全。' : '拖动旋转 · 滚轮缩放 · 逐格战术操作。'}</span>`,
  `              <button onClick={() => setCameraResetToken((value) => value + 1)}>重置视图</button>
              <span>{rendererMode === '3d'
                ? mode === 'travel'
                  ? '3D 旅行：点击远端 Hex 规划路径；拖动旋转，滚轮缩放。'
                  : '3D 战术：拖动旋转 · 滚轮缩放 · 逐格战术操作。'
                : mode === 'travel'
                  ? '2D 旅行：总览路径、风险、地标与世界状态。'
                  : '2D 战术：有效目标、敌人意图与计划中的旅行路径同时可见。'}</span>`,
  'HexPrototype toolbar help',
)
prototype = replaceRequired(
  prototype,
  `          <div className="visual-board-frame hex-board-frame">
            {mode === 'travel' ? (
              <HexTravelMap state={state} path={travelPath} selectedCoord={selectedCoord} hoverCoord={hoverCoord} preference={travelPreference} onCellClick={handleBoardClick} onCellHover={setHoverCoord} />
            ) : (
              <HexThreeBoard state={state} selectedCoord={selectedCoord} hoverCoord={hoverCoord} selection={selection} targetLayer={targetLayer} cameraResetToken={cameraResetToken} showSky={showSky} showDebug={showDebug} event={currentEvent} onCellClick={handleBoardClick} onCellHover={setHoverCoord} />
            )}`,
  `          <div className={\`visual-board-frame hex-board-frame view-\${rendererMode}\`}>
            {rendererMode === '2d' ? (
              <HexTravelMap
                state={state}
                mode={mode}
                path={travelPath}
                selectedCoord={selectedCoord}
                hoverCoord={hoverCoord}
                selection={selection}
                targetLayer={targetLayer}
                preference={travelPreference}
                onCellClick={handleBoardClick}
                onCellHover={setHoverCoord}
              />
            ) : (
              <HexThreeBoard
                state={state}
                mode={mode}
                travelPath={travelPath}
                travelTarget={travelTarget}
                travelPreference={travelPreference}
                selectedCoord={selectedCoord}
                hoverCoord={hoverCoord}
                selection={selection}
                targetLayer={targetLayer}
                cameraResetToken={cameraResetToken}
                showSky={showSky}
                showDebug={showDebug}
                event={currentEvent}
                onCellClick={handleBoardClick}
                onCellHover={setHoverCoord}
              />
            )}`,
  'HexPrototype renderer branch',
)

fs.writeFileSync(prototypePath, prototype)

const boardPath = 'src/hex/HexThreeBoard.tsx'
let board = fs.readFileSync(boardPath, 'utf8')
board = replaceRequired(
  board,
  "import { hexDirectionYaw, hexWorldOffset } from './hexTopology'",
  "import { hexDirectionYaw, hexWorldOffset } from './hexTopology'\nimport type { HexMode, TravelPreference } from './hexTravel'",
  'HexThreeBoard travel types import',
)
board = replaceRequired(
  board,
  `  state: GameState
  selectedCoord: Coord`,
  `  state: GameState
  mode?: HexMode
  travelPath?: Coord[]
  travelTarget?: Coord
  travelPreference?: TravelPreference
  selectedCoord: Coord`,
  'HexThreeBoard props',
)
board = replaceRequired(
  board,
  `export function HexThreeBoard({
  state,
  selectedCoord,`,
  `export function HexThreeBoard({
  state,
  mode = 'tactical',
  travelPath = [],
  travelTarget,
  travelPreference = 'fastest',
  selectedCoord,`,
  'HexThreeBoard destructure',
)
board = replaceRequired(
  board,
  `    const player = getPlayer(state)

    for (const actor of state.actors.filter((entry) => entry.alive && entry.faction === 'enemy')) {`,
  `    const player = getPlayer(state)

    if (travelPath.length > 1) {
      const points = travelPath.map((coord) => hexWorldPosition(coord, state, 0.2))
      const pathMaterial = new THREE.LineDashedMaterial({
        color: travelPreference === 'fastest' ? 0xf4ca62 : 0x69ddb0,
        transparent: true,
        opacity: mode === 'travel' ? 0.92 : 0.3,
        dashSize: 0.2,
        gapSize: 0.09,
      })
      const pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), pathMaterial)
      pathLine.computeLineDistances()
      pathLine.renderOrder = 20
      content.add(pathLine)
    }

    if (travelTarget) {
      const targetPosition = hexWorldPosition(travelTarget, state, 0.23)
      const targetMaterial = new THREE.MeshBasicMaterial({
        color: travelPreference === 'fastest' ? 0xffda72 : 0x76e4b4,
        transparent: true,
        opacity: mode === 'travel' ? 0.92 : 0.45,
        depthWrite: false,
      })
      const targetMarker = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.42, 6), targetMaterial)
      targetMarker.rotation.x = -Math.PI / 2
      targetMarker.position.copy(targetPosition)
      targetMarker.renderOrder = 21
      content.add(targetMarker)
      bobRef.current.push({ object: targetMarker, baseY: targetMarker.position.y, phase: 0, amplitude: 0.035, speed: 3.4 })
    }

    if (mode === 'tactical') for (const actor of state.actors.filter((entry) => entry.alive && entry.faction === 'enemy')) {`,
  'HexThreeBoard travel overlays',
)
board = replaceRequired(
  board,
  `  }, [state, selection, targetLayer, showSky, showDebug, event])`,
  `  }, [state, mode, travelPath, travelTarget, travelPreference, selection, targetLayer, showSky, showDebug, event])`,
  'HexThreeBoard effect dependencies',
)

fs.writeFileSync(boardPath, board)
