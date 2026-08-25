import { mkdir, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const pageUrl = 'http://127.0.0.1:4180/ProjectC-WebPrototype/'
const debugUrl = 'http://127.0.0.1:9229'
const artifactDir = resolve('artifacts')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message, detail) => { if (!condition) throw new Error(`${message}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ''}`) }
const which = (command) => { const result = spawnSync('which', [command], { encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim() : '' }
function chromeExecutable() {
  const candidates = [process.env.CHROME_BIN, which('google-chrome'), which('google-chrome-stable'), which('chromium'), which('chromium-browser')].filter(Boolean)
  assert(candidates.length, 'Chrome / Chromium executable was not found')
  return candidates[0]
}
async function waitFor(label, operation, attempts = 240, delay = 45) {
  let lastError
  for (let index = 0; index < attempts; index += 1) {
    try { return await operation() } catch (error) { lastError = error; if (index + 1 < attempts) await sleep(delay) }
  }
  throw new Error(`${label} did not become ready: ${lastError?.message ?? lastError}`)
}
class CdpClient {
  constructor(url) { this.id = 1; this.pending = new Map(); this.socket = new WebSocket(url) }
  async open() {
    if (this.socket.readyState !== WebSocket.OPEN) await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data)); const pending = this.pending.get(payload.id); if (!pending) return
      this.pending.delete(payload.id); payload.error ? pending.reject(new Error(payload.error.message)) : pending.resolve(payload.result)
    })
  }
  send(method, params = {}) {
    const id = this.id++
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })) })
  }
  close() { this.socket.close() }
}
async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed')
  return response.result.value
}

const snapshotExpression = `(() => {
  const root=document.querySelector('.cell-world-prototype[data-implementation="cell-world-spatial-ab-v3"]');
  const board=root?.querySelector('.cell-world-board'); const pendulum=root?.querySelector('.thermal-pendulum');
  const canvas=board?.querySelector('canvas'); const rect=canvas?.getBoundingClientRect();
  return {
    implementation:root?.dataset.implementation??'', authority:root?.dataset.authority??'',
    aimContract:root?.dataset.basicAimContract??'', basicRules:root?.dataset.basicMoveRules??'', driveRule:root?.dataset.driveRule??'', axisUi:root?.dataset.axisUi??'',
    knockbackResolution:root?.dataset.knockbackResolution??'', axisDisplayOverride:root?.dataset.axisDisplayOverride??'', actorCollisionRestitution:Number(root?.dataset.actorCollisionRestitution??NaN),
    actionId:root?.dataset.actionId??'', spatialMode:root?.dataset.spatialMode??'', playing:root?.dataset.playing==='true', worldAt:Number(root?.dataset.worldAt??-1),
    logicalX:Number(root?.dataset.logicalX??NaN), logicalZ:Number(root?.dataset.logicalZ??NaN), momentum:Number(root?.dataset.momentum??-1), axisId:root?.dataset.axisId??'',
    atVisualMs:Number(root?.dataset.atVisualMs??0), thermalPeriodAt:Number(root?.dataset.thermalPeriodAt??0), pushAtomic:root?.dataset.pushAtomic??'',
    boardAxisStyle:board?.dataset.axisStyle??'', actorAxisPersistent:board?.dataset.actorAxisPersistent??'', boardAxisDirection:board?.dataset.axisDirection??'',
    boardAxisLengthPx:Number(board?.dataset.axisLengthPx??0), boardAxisStrokePx:Number(board?.dataset.axisStrokePx??0), boardAxisSupportsDown:board?.dataset.axisSupportsDown??'',
    boardAxisAnchor:board?.dataset.axisAnchor??'', boardAxisDownStyle:board?.dataset.axisDownStyle??'', boardAxisOverride:board?.dataset.axisDisplayOverride??'',
    previewStyle:board?.dataset.previewStyle??'', previewArrow:board?.dataset.previewArrow??'', previewAuthority:board?.dataset.previewAuthority??'',
    reachableHighlight:board?.dataset.reachableHighlight??'', knockbackPreview:board?.dataset.knockbackPreview??'', knockbackPlayback:board?.dataset.knockbackPlayback??'', knockbackPathCount:Number(board?.dataset.knockbackPathCount??0),
    playerPlaybackProgress:Number(board?.dataset.playerPlaybackProgress??0), playerPlaybackEnd:Number(board?.dataset.playerPlaybackEnd??1), actorPlaybackWindowCount:Number(board?.dataset.actorPlaybackWindowCount??0),
    middlePan:board?.dataset.middlePan??'', viewportWidth:Number(board?.dataset.viewportWidth??0), viewportHeight:Number(board?.dataset.viewportHeight??0), canvasWidth:Number(rect?.width??0), canvasHeight:Number(rect?.height??0),
    thermalCycleAt:Number(pendulum?.dataset.cycleAt??0), thermalPlaybackInterpolation:pendulum?.dataset.playbackInterpolation??'', actionCardCount:root?.querySelectorAll('.action-card').length??0,
    holdCardCount:root?.querySelectorAll('[data-action-id="hold"]').length??0, resetDisabled:Boolean(root?.querySelector('.session-buttons button:last-child')?.disabled),
    actorAxisHudCount:root?.querySelectorAll('.actor-axis-hud').length??0, downAxisControlCount:root?.querySelectorAll('[data-axis-display^="down-"]').length??0,
    separateAxisWindow:root?.querySelectorAll('.unified-axis-hud,.axis-indicator-card').length??0
  }
})()`
const snapshot = (client) => evaluate(client, snapshotExpression)
async function idleAt(client, worldAt) {
  return waitFor(`idle at ${worldAt}`, async () => { const v=await snapshot(client); if(v.playing||v.worldAt!==worldAt) throw new Error(JSON.stringify(v)); return v }, 260, 40)
}
async function resetUi(client) { assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.reset()`),'reset failed'); return idleAt(client,0) }
async function setAction(client,id) { assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.setAction(${JSON.stringify(id)})`),`action ${id} rejected`); return waitFor(`action ${id}`,async()=>{const v=await snapshot(client);if(v.actionId!==id)throw new Error(JSON.stringify(v));return v}) }
async function setKinematics(client,axisId,level) {
  assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.setKinematics(${JSON.stringify(axisId)},${level})`),'setKinematics failed')
  return waitFor(`kinematics ${axisId} M${level}`,async()=>{const v=await snapshot(client);const expected=axisId==='none'?'none':axisId;if(v.axisId!==expected||v.momentum!==level)throw new Error(JSON.stringify(v));if(axisId!=='none'&&v.spatialMode==='discrete'&&v.boardAxisDirection!==axisId)throw new Error(`axis=${v.boardAxisDirection}`);if(axisId!=='none'&&v.spatialMode==='hybrid'&&level>0&&v.boardAxisDirection!=='continuous')throw new Error(`axis=${v.boardAxisDirection}`);return v})
}
async function setAxisDisplay(client,value) {
  assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.setAxisDisplay(${JSON.stringify(value)})`),`Axis display ${value} rejected`)
  return waitFor(`Axis display ${value}`,async()=>{const v=await snapshot(client);if(v.axisDisplayOverride!==value||v.boardAxisOverride!==value)throw new Error(JSON.stringify(v));const expected=value.startsWith('down-')?'down':v.spatialMode==='hybrid'&&v.momentum>0?'continuous':v.axisId;if(expected&&v.boardAxisDirection!==expected)throw new Error(`axis=${v.boardAxisDirection}`);return v})
}
async function setAtMs(client,value) { assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.setAtMs(${value})`),'AT setter failed'); return waitFor(`AT ${value}`,async()=>{const v=await snapshot(client);if(v.atVisualMs!==value)throw new Error(JSON.stringify(v));return v}) }
async function setThermal(client,value) { assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.setThermalPeriod(${value})`),'Thermal setter failed'); return waitFor(`Thermal ${value}`,async()=>{const v=await snapshot(client);if(v.thermalPeriodAt!==value||v.thermalCycleAt!==value)throw new Error(JSON.stringify(v));return v}) }
async function setCollisionSurfaces(client,enabled) {
  const desired=enabled?'ON':'OFF'
  assert(await evaluate(client,`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Collision Surfaces'));if(!b)return false;if(!b.textContent.includes('${desired}'))b.click();return true})()`),'Collision control missing')
  return waitFor(`Collision ${desired}`,async()=>{const label=await evaluate(client,`([...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Collision Surfaces'))?.textContent??'')`);if(!label.includes(desired))throw new Error(label);return label})
}
const reachKey=(entry)=>{const h=entry.finalHex??entry.targetHex;return `${h.q},${h.r}`}
async function waitReach(client,expectedKeys) {
  const expected=[...expectedKeys].sort().join('|')
  return waitFor(`reach ${expected}`,async()=>{const r=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.reachability()`);const actual=r.map(reachKey).sort().join('|');if(actual!==expected)throw new Error(`actual=${actual}`);return r})
}
function sampleHex(sample) { const r=Math.round(sample.position.z/0.8660254037844386);const q=Math.round(sample.position.x-r*0.5);return `${q},${r}` }
async function waitTrajectory(client,expectedHexes) {
  return waitFor(`trajectory ${expectedHexes.join('→')}`,async()=>{const samples=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.trajectory()`);const raw=samples.map(sampleHex);const compact=raw.filter((v,i)=>i===0||v!==raw[i-1]);if(compact.join('|')!==expectedHexes.join('|'))throw new Error(`actual=${compact.join('→')}`);return samples})
}
async function setConflictScenario(client,kind) {
  assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.setConflictScenario(${JSON.stringify(kind)})`),`${kind} scenario rejected`)
  const expected=kind==='chain'?{x:.5,z:.8660254}:{x:-1,z:0}
  return waitFor(`${kind} scenario`,async()=>{const v=await snapshot(client);if(v.playing||v.worldAt!==0||v.axisId!=='E'||v.momentum!==2||Math.abs(v.logicalX-expected.x)>.02||Math.abs(v.logicalZ-expected.z)>.02)throw new Error(JSON.stringify(v));return v})
}

let previewProcess, chromeProcess, client
try {
  previewProcess=spawn('pnpm',['exec','vite','preview','--host','127.0.0.1','--port','4180','--strictPort'],{stdio:['ignore','pipe','pipe']})
  previewProcess.stdout.on('data',c=>process.stdout.write(`[preview] ${c}`));previewProcess.stderr.on('data',c=>process.stderr.write(`[preview] ${c}`))
  await waitFor('Vite preview',async()=>{const r=await fetch(pageUrl);if(!r.ok)throw new Error(`HTTP ${r.status}`);return true})
  chromeProcess=spawn(chromeExecutable(),['--headless=new','--no-sandbox','--hide-scrollbars','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--enable-unsafe-swiftshader','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9229',`--user-data-dir=${join(tmpdir(),`projectc-stepwise-${process.pid}`)}`,'--window-size=1600,1100','about:blank'],{stdio:['ignore','ignore','pipe']})
  await waitFor('Chrome DevTools',async()=>{const r=await fetch(`${debugUrl}/json/version`);if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()},240,50)
  const targetResponse=await fetch(`${debugUrl}/json/new?${encodeURIComponent(pageUrl)}`,{method:'PUT'});assert(targetResponse.ok,'Failed to create target');const target=await targetResponse.json()
  client=new CdpClient(target.webSocketDebuggerUrl);await client.open();await client.send('Page.enable');await client.send('Runtime.enable');await client.send('Page.bringToFront');await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});await client.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1100,deviceScaleFactor:1,mobile:false});await client.send('Page.navigate',{url:pageUrl})

  const initial=await waitFor('initialized visible map',async()=>{const v=await snapshot(client);if(v.implementation!=='cell-world-spatial-ab-v3'||v.actionCardCount!==7||v.holdCardCount!==1||v.viewportWidth<700||v.viewportHeight<300||v.canvasWidth<700||v.canvasHeight<300)throw new Error(JSON.stringify(v));return v})
  assert(initial.authority==='cell-world-plus-spatial-state','authority missing',initial)
  assert(initial.atVisualMs===500&&initial.thermalPeriodAt===4&&initial.thermalCycleAt===4,'default timebase must be 4 AT / 0.5s',initial)
  assert(initial.aimContract==='reachable-cell-target-v4'&&initial.basicRules==='connected-envelope-m-spend-v4'&&initial.driveRule==='cell-target-curved-composition','movement contract missing',initial)
  assert(initial.axisUi==='actor-body-screen-arrow-v5'&&initial.boardAxisStyle==='actor-body-screen-arrow-v5'&&initial.actorAxisPersistent==='true','Actor Axis UI wrong',initial)
  assert(initial.boardAxisLengthPx===30&&Math.abs(initial.boardAxisStrokePx-2.5)<.01&&initial.boardAxisSupportsDown==='true','Axis tuning / Down support regressed',initial)
  assert(initial.boardAxisAnchor==='actor-body'&&initial.boardAxisDownStyle==='unified-arrow-v1','Axis must be body-anchored and unified',initial)
  assert(initial.actorAxisHudCount===1&&initial.downAxisControlCount===3&&initial.separateAxisWindow===0,'Axis HUD structure wrong',initial)
  assert(Math.abs(initial.actorCollisionRestitution-.75)<.001,'Actor restitution missing',initial)
  assert(initial.previewStyle==='blue-dashed-no-arrow-v3'&&initial.previewArrow==='none'&&initial.previewAuthority==='cell-target-path-v3','path UI wrong',initial)
  assert(initial.reachableHighlight==='lifted-outline-v3'&&initial.knockbackPreview==='yellow-dashed-path-v2'&&initial.knockbackPlayback==='contact-staggered-fast-v3','knockback UI wrong',initial)
  assert(initial.knockbackResolution==='stepwise-reflect-v1'&&initial.pushAtomic==='false','stepwise conflict contract missing',initial)
  assert(initial.middlePan==='enabled'&&!initial.resetDisabled,'board safety controls regressed',initial)

  const downM2=await setAxisDisplay(client,'down-2');assert(downM2.boardAxisDirection==='down','Down Axis failed',downM2);const axisAuto=await setAxisDisplay(client,'auto')
  const thermal6=await setThermal(client,6),thermal8=await setThermal(client,8),thermal4=await setThermal(client,4)
  await setAtMs(client,250);await setCollisionSurfaces(client,false)

  await resetUi(client);await setAction(client,'basic-move');await setKinematics(client,'none',0)
  const reachM0=await waitReach(client,['-1,0','-1,1','0,-1','0,1','1,-1','1,0']);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(1,0)`),'M0 establish rejected');const afterEstablish=await idleAt(client,1);assert(afterEstablish.axisId==='E'&&afterEstablish.momentum===0&&afterEstablish.boardAxisDirection==='E','M0 Axis wrong',afterEstablish)

  await resetUi(client);await setAction(client,'basic-move');await setKinematics(client,'E',1)
  const reachM1=await waitReach(client,['-1,1','0,-1','0,1','1,-1','1,0']);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(1,0)`),'M1 forward rejected');const afterM1=await idleAt(client,1);assert(afterM1.momentum===2,'M1 forward must build M2',afterM1)

  const expectedM2=['0,1','1,-1','1,1','2,-1','2,0']
  await resetUi(client);await setAction(client,'basic-move');await setKinematics(client,'E',2);const reachM2=await waitReach(client,expectedM2)
  assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(2,0)`),'M2 forward rejected');const m2ForwardTrajectory=await waitTrajectory(client,['0,0','1,0','2,0']);const afterM2=await idleAt(client,1);assert(afterM2.momentum===1&&afterM2.axisId==='E','M2 Range2 must spend to M1',afterM2)

  const expectedM3=['1,2','2,1','3,-1','3,-2','3,0']
  await resetUi(client);await setAction(client,'basic-move');await setKinematics(client,'E',3);const reachM3=await waitReach(client,expectedM3)
  assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(3,0)`),'M3 forward rejected');const m3ForwardTrajectory=await waitTrajectory(client,['0,0','1,0','2,0','3,0']);const afterM3=await idleAt(client,1);assert(afterM3.momentum===2&&afterM3.axisId==='E','M3 Range3 must spend to M2',afterM3)

  await resetUi(client);await setAtMs(client,700);await setKinematics(client,'E',2)
  assert(await evaluate(client,`(()=>{const b=document.querySelector('[data-action-id="hold"]');if(!b)return false;b.click();return true})()`),'Hold card click failed')
  const holdPlaying=await waitFor('Hold playback',async()=>{const v=await snapshot(client);if(!v.playing||v.actionId!=='hold')throw new Error(JSON.stringify(v));return v})
  const afterHold=await idleAt(client,1);assert(afterHold.momentum===1&&Math.abs(afterHold.logicalX)<.02&&Math.abs(afterHold.logicalZ)<.02,'Hold must stay in Cell and dissipate M2→M1',afterHold)

  await resetUi(client);await setAtMs(client,250);await setAction(client,'basic-move');await setKinematics(client,'E',2)
  assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(-1,0)`)===false,'reverse Move accepted');const afterReverseMove=await snapshot(client);assert(!afterReverseMove.playing&&afterReverseMove.worldAt===0&&afterReverseMove.momentum===2,'reverse Move corrupted state',afterReverseMove)
  await setAction(client,'drive');const driveReachM2=await waitReach(client,expectedM2);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(-1,0)`)===false,'reverse Drive accepted');const afterReverseDrive=await snapshot(client);assert(!afterReverseDrive.playing&&afterReverseDrive.worldAt===0&&afterReverseDrive.momentum===2,'reverse Drive corrupted state',afterReverseDrive)
  assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(1,-1)`),'Discrete Drive landing rejected');const driveTrajectory=await waitTrajectory(client,['0,0','1,0','1,-1']);await idleAt(client,1)

  await setCollisionSurfaces(client,true);await setAtMs(client,900);await setConflictScenario(client,'chain')
  assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(2,1)`),'chain knockback rejected')
  const duringChain=await waitFor('player contact before actor launch',async()=>{const v=await snapshot(client);if(!v.playing||v.playerPlaybackProgress<.99||v.actorPlaybackWindowCount<3)throw new Error(JSON.stringify(v));return v})
  const chainPaths=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.actorTrajectories()`);const chainWindows=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.actorPlaybackWindows()`)
  assert((chainPaths['dummy-a']?.length??0)>=3&&(chainPaths['dummy-b']?.length??0)>=2&&(chainPaths['dummy-c']?.length??0)>=2,'chain paths missing',chainPaths)
  assert(chainWindows['dummy-a'].start>duringChain.playerPlaybackEnd&&chainWindows['dummy-a'].end-chainWindows['dummy-a'].start<.4,'first launch must begin after contact and resolve faster',{duringChain,chainWindows})
  assert(chainWindows['dummy-a'].start<chainWindows['dummy-b'].start&&chainWindows['dummy-b'].start<chainWindows['dummy-c'].start,'chain launch windows must stagger',chainWindows)
  const transferEvents=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.conflicts()`);const primaryTransfer=transferEvents.find(e=>e.kind==='momentum-transfer'&&e.sourceActorId==='player')
  assert(primaryTransfer&&primaryTransfer.sourceBeforeM===2&&primaryTransfer.targetBeforeM===0&&primaryTransfer.sourceAfterM===1&&primaryTransfer.targetAfterM===2,'M2+M0 exchange wrong',transferEvents)
  const afterChain=await idleAt(client,1);const chainState=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.snapshot()`);const chainCells=Object.fromEntries(chainState.actors.map(a=>[a.id,`${a.hex.q},${a.hex.r}`]));assert(JSON.stringify(chainCells)===JSON.stringify({'dummy-a':'4,1','dummy-b':'5,1','dummy-c':'6,1'}),'chain final Cells wrong',chainCells)
  const actorASpeed=Math.hypot(chainState.actors[0].velocity.x,chainState.actors[0].velocity.z);assert(afterChain.momentum===1&&actorASpeed>=1.2&&actorASpeed<2.2,'Transferred M did not persist',{afterChain,actorASpeed,chainState})

  await setConflictScenario(client,'wall');assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(1,0)`),'wall mirror-knockback rejected')
  const wallTrajectories=await waitFor('physical mirror wall trajectory',async()=>{
    const p=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.actorTrajectories()`);const path=p['dummy-a']??[];const last=path.at(-1)
    const hasContact=path.some(point=>!Number.isInteger(point.q)||!Number.isInteger(point.r));const hasQ2=path.some(point=>Math.abs(point.q-2)<1e-6&&Math.abs(point.r)<1e-6)
    const leavesOriginalLine=path.some((point,index)=>index>0&&Number.isInteger(point.q)&&Number.isInteger(point.r)&&Math.abs(point.r)>1e-6)
    if(path.length<5||!hasContact||!hasQ2||!last||!leavesOriginalLine)throw new Error(JSON.stringify(p));return p
  })
  const wallEvents=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.conflicts()`);const wallBounce=wallEvents.find(e=>e.kind==='surface-reflection'&&e.actorId==='dummy-a')
  assert(wallEvents.some(e=>e.kind==='wall-crash'&&e.partial)&&wallBounce,'wall must reach the physical contact point and reflect',wallEvents)
  assert(wallBounce.axisBefore==='E'&&wallBounce.axisAfter!=='W'&&['NW','SW'].includes(wallBounce.axisAfter)&&wallBounce.ambiguousVertexBranch===true&&wallBounce.reflectionContinuation==='contact-ray-step-budget-v3','wall vertex must choose one physical mirror face instead of a 180-degree return',wallBounce)
  assert(!wallEvents.some(e=>e.kind==='surface-stop'&&e.actorId==='dummy-a'),'wall mirror branch must not be converted into the old W surface-stop',wallEvents)
  const afterWall=await idleAt(client,1);const wallState=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.snapshot()`)
  const wallPath=wallTrajectories['dummy-a'];const wallFinal=wallState.actors[0].hex;const finalPathPoint=wallPath.at(-1)
  const crossedPlayer=wallPath.slice(1).some(point=>Number.isInteger(point.q)&&Number.isInteger(point.r)&&point.q===1&&point.r===0)
  assert(wallPath[0].q===1&&wallPath[0].r===0&&!crossedPlayer&&wallFinal.r!==0&&finalPathPoint.q===wallFinal.q&&finalPathPoint.r===wallFinal.r,'knocked Actor must leave the original line, never cross the player Cell, and finish where its path ends',{wallState,wallTrajectories,wallBounce})
  assert(Math.abs(afterWall.logicalX-1)<.02&&Math.abs(afterWall.logicalZ)<.02&&afterWall.momentum===1,'player must enter vacated contact Cell after mirror knockback',afterWall)

  await resetUi(client);await setAtMs(client,300);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.setSpatialMode('hybrid')`),'Hybrid switch failed');await setAction(client,'drive');await setKinematics(client,'E',1);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(0,-2)`),'Hybrid Drive rejected');const hybridSamples=await waitFor('Hybrid samples',async()=>{const s=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.trajectory()`);if(s.length<100)throw new Error(`samples=${s.length}`);return s});await idleAt(client,1)

  await mkdir(artifactDir,{recursive:true});const screenshot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(artifactDir,'stepwise-reflection-hold.png'),Buffer.from(screenshot.data,'base64'))
  const evidence={initial,downM2,axisAuto,thermal6,thermal8,thermal4,reachM0,afterEstablish,reachM1,afterM1,reachM2,m2ForwardTrajectory,afterM2,reachM3,m3ForwardTrajectory,afterM3,holdPlaying,afterHold,afterReverseMove,driveReachM2,afterReverseDrive,driveTrajectory,duringChain,chainWindows,primaryTransfer,afterChain,chainCells,wallTrajectories,wallEvents,wallBounce,afterWall,hybridSampleCount:hybridSamples.length}
  await writeFile(join(artifactDir,'stepwise-reflection-hold.json'),`${JSON.stringify(evidence,null,2)}\n`)
  console.log('Verified actor-body unified Axis, 4 AT / 0.5s defaults, full reflected M movement budget, direct Hold, M1/M2/M3 movement rules, staged knockback after contact, physical wall-face mirror branches, no player-target swap, strict map geometry, and Hybrid continuity.')
} finally { client?.close();chromeProcess?.kill('SIGTERM');previewProcess?.kill('SIGTERM') }
