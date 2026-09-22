import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INERTIAL_CONFIG,
  applyThermalDeposit,
  buildInertialActionPlan,
  inertialNetRate,
  sampleInertialActionPlan,
  solveInertialSegment,
} from './thermal-inertial-model.js'
import { DEFAULT_THERMAL_CONFIG, DEFAULT_THERMAL_STATE } from './thermal-clock-model.js'

const close = (a,b,d=8)=>{
  expect(a.temperature).toBeCloseTo(b.temperature,d)
  expect(a.drift).toBeCloseTo(b.drift,d)
}

describe('Thermal Inertial Relaxation candidate',()=>{
  it('keeps equilibrium fixed with no drive',()=>{
    close(solveInertialSegment(DEFAULT_THERMAL_STATE,DEFAULT_THERMAL_CONFIG,DEFAULT_INERTIAL_CONFIG,6,0),DEFAULT_THERMAL_STATE)
  })

  it('single 1AT Drive changes next Ready and leaves residual Drift',()=>{
    const plan=buildInertialActionPlan({state:DEFAULT_THERMAL_STATE,thermalConfig:DEFAULT_THERMAL_CONFIG,actionId:'heat-ii',durationAt:1,horizonAt:4})
    expect(plan.finalState.temperature).toBeGreaterThan(DEFAULT_THERMAL_STATE.temperature)
    expect(plan.finalState.drift).toBeGreaterThan(0)
    expect(plan.events.map(e=>e.type)).toEqual(['DriveStart','DriveEnd'])
  })

  it('stopping input decays residual Drift by the configured half-life',()=>{
    const state={...DEFAULT_THERMAL_STATE,drift:1}
    const after=solveInertialSegment(state,DEFAULT_THERMAL_CONFIG,{driftHalfLifeAt:1,recoveryHalfLifeAt:3},1,0)
    expect(after.drift).toBeCloseTo(0.5,8)
  })

  it('Recovery Half-Life halves temperature offset when Drift and environment are zero',()=>{
    const state={...DEFAULT_THERMAL_STATE,temperature:3,drift:0,setPoint:1}
    const config={...DEFAULT_THERMAL_CONFIG,environmentCoupling:0}
    const after=solveInertialSegment(state,config,{driftHalfLifeAt:1,recoveryHalfLifeAt:3},3,0)
    expect(after.temperature-state.setPoint).toBeCloseTo(1,7)
    expect(after.drift).toBeCloseTo(0,8)
  })

  it('opposite Drive can reduce an existing opposite Drift within one AT',()=>{
    const cold={...DEFAULT_THERMAL_STATE,drift:-0.8}
    const plan=buildInertialActionPlan({state:cold,thermalConfig:DEFAULT_THERMAL_CONFIG,actionId:'heat-iii',durationAt:1})
    expect(plan.finalState.drift).toBeGreaterThan(cold.drift)
  })

  it('mid-AT Drive end produces less influence than a full-AT Drive',()=>{
    const half=buildInertialActionPlan({state:DEFAULT_THERMAL_STATE,thermalConfig:DEFAULT_THERMAL_CONFIG,actionId:'heat-ii',driveDurationAt:0.5})
    const full=buildInertialActionPlan({state:DEFAULT_THERMAL_STATE,thermalConfig:DEFAULT_THERMAL_CONFIG,actionId:'heat-ii',driveDurationAt:1})
    expect(half.finalState.temperature).toBeLessThan(full.finalState.temperature)
    expect(half.finalState.drift).toBeLessThan(full.finalState.drift)
  })

  it('Deposit changes T instantly without changing D',()=>{
    const state={...DEFAULT_THERMAL_STATE,temperature:0.5,drift:-0.7}
    const deposited=applyThermalDeposit(state,1.25,DEFAULT_THERMAL_CONFIG)
    expect(deposited.temperature).toBeCloseTo(1.75,8)
    expect(deposited.drift).toBeCloseTo(-0.7,8)
  })

  it('mid-AT Deposit and Drive use deterministic piecewise sampling',()=>{
    const plan=buildInertialActionPlan({
      state:{...DEFAULT_THERMAL_STATE,drift:-0.4},
      thermalConfig:DEFAULT_THERMAL_CONFIG,
      actionId:'heat-i',
      driveDurationAt:0.6,
      depositAt:0.5,
      deposit:1,
    })
    const before=sampleInertialActionPlan(plan,0.4999)
    const after=sampleInertialActionPlan(plan,0.5)
    expect(after.temperature-before.temperature).toBeGreaterThan(0.99)
    expect(Math.abs(after.drift-before.drift)).toBeLessThan(0.01)
    close(sampleInertialActionPlan(plan,1),plan.finalState,8)
  })

  it('does not naturally create repeated Hot-Cold cycles after one Drive',()=>{
    const plan=buildInertialActionPlan({
      state:DEFAULT_THERMAL_STATE,
      thermalConfig:DEFAULT_THERMAL_CONFIG,
      actionId:'heat-ii',
      horizonAt:10,
    })
    const signs=plan.path.map(s=>Math.sign(s.temperature-s.setPoint)).filter(Boolean)
    let flips=0
    for(let i=1;i<signs.length;i++) if(signs[i]!==signs[i-1]) flips++
    expect(flips).toBeLessThanOrEqual(1)
  })

  it('Net Rate includes Drift, Recovery and Environment Exchange',()=>{
    const state={...DEFAULT_THERMAL_STATE,temperature:2,drift:0.5,setPoint:1}
    const config={...DEFAULT_THERMAL_CONFIG,environmentTemperature:-3,environmentCoupling:0.2}
    const rate=inertialNetRate(state,config,{driftHalfLifeAt:1,recoveryHalfLifeAt:3})
    expect(rate.netRate).toBeCloseTo(rate.drift+rate.recovery+rate.environmentExchange,10)
  })
})
