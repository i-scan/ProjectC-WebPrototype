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
const chromeExecutable = () => {
  const candidates = [process.env.CHROME_BIN, which('google-chrome'), which('google-chrome-stable'), which('chromium'), which('chromium-browser')].filter(Boolean)
  assert(candidates.length, 'Chrome / Chromium executable was not found')
  return candidates[0]
}
async function waitFor(label, operation, attempts = 220, delay = 45) {
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
    actionId:root?.dataset.actionId??'', spatialMode:root?.dataset.spatialMode??'', playing:root?.dataset.playing==='true', worldAt:Number(root?.dataset.worldAt??-1),
    logicalX:Number(root?.dataset.logicalX??NaN), logicalZ:Number(root?.dataset.logicalZ??NaN), momentum:Number(root?.dataset.momentum??-1), axisId:root?.dataset.axisId??'',
    atVisualMs:Number(root?.dataset.atVisualMs??0), thermalPeriodAt:Number(root?.dataset.thermalPeriodAt??0), pushAtomic:root?.dataset.pushAtomic??'',
    boardAxisStyle:board?.dataset.axisStyle??'', actorAxisPersistent:board?.dataset.actorAxisPersistent??'', boardAxisDirection:board?.dataset.axisDirection??'',
    previewStyle:board?.dataset.previewStyle??'', previewArrow:board?.dataset.previewArrow??'', previewAuthority:board?.dataset.previewAuthority??'',
    reachableHighlight:board?.dataset.reachableHighlight??'', knockbackPreview:board?.dataset.knockbackPreview??'', knockbackPlayback:board?.dataset.knockbackPlayback??'', middlePan:board?.dataset.middlePan??'',
    viewportWidth:Number(board?.dataset.viewportWidth??0), viewportHeight:Number(board?.dataset.viewportHeight??0), canvasWidth:Number(rect?.width??0), canvasHeight:Number(rect?.height??0),
    thermalCycleAt:Number(pendulum?.dataset.cycleAt??0), thermalPlaybackInterpolation:pendulum?.dataset.playbackInterpolation??'',
    actionCardCount:root?.querySelectorAll('.action-card').length??0, resetDisabled:Boolean(root?.querySelector('.session-buttons button:last-child')?.disabled),
    separateAxisWindow:root?.querySelectorAll('.unified-axis-hud,.axis-indicator-card').length??0
  }
})()`
const snapshot = (client) => evaluate(client, snapshotExpression)
async function waitForIdleAt(client, worldAt) {
  return waitFor(`idle at ${worldAt} AT`, async () => { const value = await snapshot(client); if (value.playing || value.worldAt !== worldAt) throw new Error(JSON.stringify(value)); return value }, 220, 40)
}
async function resetUi(client) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.reset()`), 'debug reset failed')
  return waitForIdleAt(client, 0)
}
async function selectAction(client, id) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAction(${JSON.stringify(id)})`), `action ${id} rejected`)
  return waitFor(`action ${id}`, async () => { const value = await snapshot(client); if (value.actionId !== id) throw new Error(JSON.stringify(value)); return value })
}
async function setKinematics(client, axisId, level) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setKinematics(${JSON.stringify(axisId)},${level})`), 'setKinematics failed')
  return waitFor(`kinematics ${axisId} M${level}`, async () => {
    const value = await snapshot(client); const expectedAxis = axisId === 'none' ? 'none' : axisId
    if (value.axisId !== expectedAxis || value.momentum !== level) throw new Error(JSON.stringify(value))
    if (axisId !== 'none' && value.spatialMode === 'discrete' && value.boardAxisDirection !== axisId) throw new Error(`actor Axis arrow=${value.boardAxisDirection}`)
    if (axisId !== 'none' && value.spatialMode === 'hybrid' && level > 0 && value.boardAxisDirection !== 'continuous') throw new Error(`Hybrid Axis arrow=${value.boardAxisDirection}`)
    return value
  })
}
async function setAtMs(client, value) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setAtMs(${value})`), 'AT setter failed')
  return waitFor(`AT ${value}`, async () => { const current=await snapshot(client); if(current.atVisualMs!==value) throw new Error(JSON.stringify(current)); return current })
}
async function setThermalPeriod(client, value) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setThermalPeriod(${value})`), 'Thermal setter failed')
  return waitFor(`Thermal ${value}`, async () => { const current=await snapshot(client); if(current.thermalPeriodAt!==value||current.thermalCycleAt!==value) throw new Error(JSON.stringify(current)); return current })
}
async function setCollisionSurfaces(client, enabled) {
  const desired = enabled ? 'ON' : 'OFF'
  await evaluate(client, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Collision Surfaces')); if(!b)return false; if(!b.textContent.includes('${desired}'))b.click(); return true })()`)
  return waitFor(`Collision ${desired}`, async () => {
    const label=await evaluate(client, `([...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Collision Surfaces'))?.textContent??'')`)
    if(!label.includes(desired)) throw new Error(label); return label
  })
}
const reachKey = (entry) => { const hex=entry.finalHex??entry.targetHex; return `${hex.q},${hex.r}` }
async function waitReach(client, expectedKeys) {
  const expected=[...expectedKeys].sort().join('|')
  return waitFor(`reachability ${expected}`, async () => { const reach=await evaluate(client, `window.__PROJECTC_PROTOTYPE__.reachability()`); const actual=reach.map(reachKey).sort().join('|'); if(actual!==expected) throw new Error(`actual=${actual}`); return reach })
}
function sampleHex(sample) { const r=Math.round(sample.position.z/0.8660254037844386); const q=Math.round(sample.position.x-r*0.5); return `${q},${r}` }
async function waitTrajectory(client, expectedHexes) {
  return waitFor(`trajectory ${expectedHexes.join('→')}`, async () => {
    const samples=await evaluate(client, `window.__PROJECTC_PROTOTYPE__.trajectory()`); const raw=samples.map(sampleHex); const compact=raw.filter((v,i)=>i===0||v!==raw[i-1])
    if(compact.join('|')!==expectedHexes.join('|')) throw new Error(`actual=${compact.join('→')}`); return samples
  })
}
async function setConflictScenario(client, kind) {
  assert(await evaluate(client, `window.__PROJECTC_PROTOTYPE__.setConflictScenario('${kind}')`), `${kind} scenario rejected`)
  const expected=kind==='chain'?{x:0.5,z:0.8660254}:{x:0,z:0}
  return waitFor(`${kind} scenario`, async()=>{const v=await snapshot(client);if(v.playing||v.worldAt!==0||v.axisId!=='E'||v.momentum!==2||Math.abs(v.logicalX-expected.x)>.02||Math.abs(v.logicalZ-expected.z)>.02)throw new Error(JSON.stringify(v));return v})
}

let previewProcess, chromeProcess, client
try {
  previewProcess=spawn('pnpm',['exec','vite','preview','--host','127.0.0.1','--port','4180','--strictPort'],{stdio:['ignore','pipe','pipe']})
  previewProcess.stdout.on('data',c=>process.stdout.write(`[preview] ${c}`)); previewProcess.stderr.on('data',c=>process.stderr.write(`[preview] ${c}`))
  await waitFor('Vite preview',async()=>{const r=await fetch(pageUrl);if(!r.ok)throw new Error(`HTTP ${r.status}`);return true})
  const userDataDir=join(tmpdir(),`projectc-reachable-${process.pid}`)
  chromeProcess=spawn(chromeExecutable(),['--headless=new','--no-sandbox','--hide-scrollbars','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--enable-unsafe-swiftshader','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9229',`--user-data-dir=${userDataDir}`,'--window-size=1600,1100','about:blank'],{stdio:['ignore','ignore','pipe']})
  await waitFor('Chrome DevTools',async()=>{const r=await fetch(`${debugUrl}/json/version`);if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()},240,50)
  const targetResponse=await fetch(`${debugUrl}/json/new?${encodeURIComponent(pageUrl)}`,{method:'PUT'});assert(targetResponse.ok,'Failed to create target');const target=await targetResponse.json()
  client=new CdpClient(target.webSocketDebuggerUrl);await client.open();await client.send('Page.enable');await client.send('Runtime.enable');await client.send('Page.bringToFront');await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});await client.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1100,deviceScaleFactor:1,mobile:false});await client.send('Page.navigate',{url:pageUrl})

  const initial=await waitFor('initialized visible map',async()=>{const v=await snapshot(client);if(v.implementation!=='cell-world-spatial-ab-v3'||v.actionCardCount!==6||v.viewportWidth<700||v.viewportHeight<300||v.canvasWidth<700||v.canvasHeight<300)throw new Error(JSON.stringify(v));return v})
  assert(initial.authority==='cell-world-plus-spatial-state','authority missing',initial);assert(initial.aimContract==='reachable-cell-target-v3','landing contract missing',initial);assert(initial.basicRules==='connected-envelope-v3','envelope missing',initial);assert(initial.driveRule==='cell-target-curved-composition','Drive rule missing',initial)
  assert(initial.axisUi==='actor-world-arrow-v3'&&initial.boardAxisStyle==='actor-world-arrow-v3'&&initial.actorAxisPersistent==='true'&&initial.separateAxisWindow===0,'actor Axis UI wrong',initial)
  assert(initial.previewStyle==='blue-dashed-no-arrow-v3'&&initial.previewArrow==='none'&&initial.previewAuthority==='cell-target-path-v3','player path UI wrong',initial)
  assert(initial.reachableHighlight==='lifted-outline-v3'&&initial.knockbackPreview==='yellow-dashed-path-v2'&&initial.knockbackPlayback==='animated-actor-path-v2','reach/knockback UI wrong',initial)
  assert(initial.middlePan==='enabled'&&initial.pushAtomic==='true'&&!initial.resetDisabled,'board safety controls regressed',initial)

  const thermal4=await setThermalPeriod(client,4), thermal6=await setThermalPeriod(client,6), thermal8=await setThermalPeriod(client,8);await setAtMs(client,300);await setCollisionSurfaces(client,false)
  await resetUi(client);await selectAction(client,'basic-move');await setKinematics(client,'none',0);const reachM0=await waitReach(client,['-1,0','-1,1','0,-1','0,1','1,-1','1,0']);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(1,0)`),'M0 E rejected');const afterEstablish=await waitForIdleAt(client,1);assert(afterEstablish.axisId==='E'&&afterEstablish.momentum===0&&afterEstablish.boardAxisDirection==='E','M0 Axis wrong',afterEstablish);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(2,0)`),'M0 same Axis rejected');const afterM0Build=await waitForIdleAt(client,2);assert(afterM0Build.momentum===1&&afterM0Build.axisId==='E','M0 build wrong',afterM0Build)
  await resetUi(client);await selectAction(client,'basic-move');await setKinematics(client,'E',1);const reachM1=await waitReach(client,['-1,1','0,-1','0,1','1,-1','1,0']);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(0,-1)`),'M1 NW rejected');const m1NwTrajectory=await waitTrajectory(client,['0,0','1,-1','0,-1']);await waitForIdleAt(client,1)
  await resetUi(client);await selectAction(client,'basic-move');await setKinematics(client,'E',2);const expectedM2=['0,1','1,-1','1,1','2,-1','2,0'];const reachM2=await waitReach(client,expectedM2);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(1,-1)`),'M2 inner NE rejected');const m2InnerTrajectory=await waitTrajectory(client,['0,0','1,0','1,-1']);await waitForIdleAt(client,1)
  await resetUi(client);await selectAction(client,'basic-move');await setKinematics(client,'E',3);const expectedM3=['0,2','1,2','2,-2','2,1','3,-1','3,-2','3,0'];const reachM3=await waitReach(client,expectedM3);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(3,-1)`),'M3 connector rejected');const m3ConnectorTrajectory=await waitTrajectory(client,['0,0','1,0','2,0','3,-1']);await waitForIdleAt(client,1)

  await resetUi(client);await selectAction(client,'basic-move');await setKinematics(client,'E',2);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(-1,0)`)===false,'reverse Move accepted');const afterReverseMove=await snapshot(client);assert(!afterReverseMove.playing&&afterReverseMove.worldAt===0&&afterReverseMove.momentum===2,'reverse Move corrupted state',afterReverseMove)
  await selectAction(client,'drive');const driveReachM2=await waitReach(client,expectedM2);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(-1,0)`)===false,'reverse Drive accepted');const afterReverseDrive=await snapshot(client);assert(!afterReverseDrive.playing&&afterReverseDrive.worldAt===0&&afterReverseDrive.axisId==='E'&&afterReverseDrive.momentum===2,'reverse Drive corrupted state',afterReverseDrive);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.reset()`),'Reset failed after reverse Drive');await waitForIdleAt(client,0)
  await selectAction(client,'drive');await setKinematics(client,'E',2);await waitReach(client,expectedM2);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(1,-1)`),'Discrete Drive landing rejected');const driveTrajectory=await waitTrajectory(client,['0,0','1,0','1,-1']);await waitForIdleAt(client,1)

  await setCollisionSurfaces(client,true);await setConflictScenario(client,'chain');await waitFor('chain forward landing',async()=>{const reach=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.reachability()`);if(!reach.some(e=>reachKey(e)==='2,1'))throw new Error(JSON.stringify(reach));return reach});assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(2,1)`),'chain knockback rejected')
  const chainTrajectories=await waitFor('chain trajectories',async()=>{const p=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.actorTrajectories()`);if((p['dummy-a']?.length??0)<3||(p['dummy-b']?.length??0)<2||(p['dummy-c']?.length??0)<2)throw new Error(JSON.stringify(p));return p});const duringChain=await snapshot(client);assert(duringChain.playing&&duringChain.knockbackPlayback==='animated-actor-path-v2','knockback not animated',duringChain);await waitForIdleAt(client,1);const chainState=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.snapshot()`);const chainCells=Object.fromEntries(chainState.actors.map(a=>[a.id,`${a.hex.q},${a.hex.r}`]));assert(JSON.stringify(chainCells)===JSON.stringify({'dummy-a':'4,1','dummy-b':'5,1','dummy-c':'6,1'}),'chain final Cells wrong',chainCells)
  await setConflictScenario(client,'wall');assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(2,0)`),'wall conflict rejected');const wallTrajectories=await waitFor('wall trajectories',async()=>{const p=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.actorTrajectories()`);if(!p['dummy-a'])throw new Error(JSON.stringify(p));return p});const afterWall=await waitForIdleAt(client,1);const wallState=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.snapshot()`);assert(wallState.actors[0].hex.q===2&&wallState.actors[0].hex.r===0&&wallTrajectories['dummy-a'].length===1,'wall atomic block wrong',{wallState,wallTrajectories});assert(Math.abs(afterWall.logicalX-1)<.02&&Math.abs(afterWall.logicalZ)<.02,'player entered blocked actor Cell',afterWall)

  await resetUi(client);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.setSpatialMode('hybrid')`),'Hybrid switch failed');await selectAction(client,'drive');await setKinematics(client,'E',1);assert(await evaluate(client,`window.__PROJECTC_PROTOTYPE__.fireAt(0,-2)`),'Hybrid Drive rejected');const hybridSamples=await waitFor('Hybrid samples',async()=>{const s=await evaluate(client,`window.__PROJECTC_PROTOTYPE__.trajectory()`);if(s.length<100)throw new Error(`samples=${s.length}`);return s});await waitForIdleAt(client,1)

  await mkdir(artifactDir,{recursive:true});const screenshot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(artifactDir,'reachable-curves-knockback.png'),Buffer.from(screenshot.data,'base64'))
  const evidence={initial,thermal4,thermal6,thermal8,reachM0,afterEstablish,afterM0Build,reachM1,m1NwTrajectory,reachM2,m2InnerTrajectory,reachM3,m3ConnectorTrajectory,afterReverseMove,afterReverseDrive,driveReachM2,driveTrajectory,chainTrajectories,chainCells,wallTrajectories,hybridSampleCount:hybridSamples.length};await writeFile(join(artifactDir,'reachable-curves-knockback.json'),`${JSON.stringify(evidence,null,2)}\n`)
  console.log('Verified connected M1/M2/M3 landing geometry, obstacle-aware legality, destination clicks, safe reverse Move/Drive, curved Discrete Drive, actor Axis arrow, readable highlights, animated atomic knockback, Thermal periods, map geometry, and Hybrid continuity.')
} finally { client?.close(); chromeProcess?.kill('SIGTERM'); previewProcess?.kill('SIGTERM') }
