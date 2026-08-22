# ProjectC Web Prototype Instructions

## Active scope

The active runtime is the Cell World inertia A/B lab on `main`.

Hybrid authoritative movement state:

```text
Position(x,z) + Velocity(x,z)
```

Shared user input:

```text
Action + Aim Cell → direction / impulse intent → resolve fixed 1 AT
```

A clicked Cell defines **direction**, not a requested destination. Preview and execution must use the same solver result.

## Current actions

### Basic Move

Basic Move is a base command, not an impulse card.

- cost: 1 AT;
- Aim Cell defines voluntary movement direction only;
- base voluntary displacement: 1 Cell-equivalent / AT;
- current inertia is added to that voluntary movement;
- Basic Move does not automatically add, spend, or reset persistent Momentum / Velocity;
- at M0, Basic Move therefore moves one Cell-equivalent while remaining M0.

Do not restore the old destination-selection / reachable-field interpretation of Basic Move.

### Drive / Heavy Drive

Drive actions are free-direction impulses. The physical formula is authoritative:

```text
AimDirection = normalize(AimCellCenter - Position)
V_after = clampLength(V_before + AimDirection * Force, MaxSpeed)
```

- Drive `Force = 0.85`;
- Heavy Drive `Force = 1.35`;
- there is **no pre-impulse steering-angle legality check**;
- the resulting direction is whatever vector addition produces;
- Hybrid curve geometry must never alter the final resultant Velocity.

### Counter / Hard Turn / Coast

- Counter Impulse keeps its reverse-direction semantic and may enforce a reverse aim window.
- Hard Turn is a smaller free-direction correction impulse.
- Coast applies no new impulse and preserves current Velocity.

## Spatial A/B

Discrete and Hybrid are intentional comparison modes in the current lab. They share:

- the same board;
- the same actions;
- the same Aim Cell input;
- the same fixed 1 AT logical cost;
- the same delayed logical-state commit rule.

Discrete presents the result through Cell-centered movement steps.

Hybrid resolves continuous Position / Velocity. When an impulse changes heading, its sampled path may bend continuously from the incoming Velocity direction toward the mixed outgoing Velocity direction. Curve handles are bounded geometry helpers only. Playback speed magnitude comes from physical before/after Velocity, and collisions reflect physical Velocity rather than the Hermite derivative.

## Momentum / preview visualization

- the yellow Axis arrow means **direction only**;
- keep the Axis arrow short, thick and fixed-length; do not scale it by Momentum level;
- the three actor dots alone encode M1 / M2 / M3 magnitude;
- prediction is a short, thick dashed guide of the immediate trajectory trend, not a full-path annotation;
- Hybrid preview follows the same curved solver samples that playback consumes;
- current preview visual horizon is about 1.55 world units.

## AT / Thermal timebase

Logical time and playback seconds are separate:

- one action always costs exactly 1 AT;
- solver baseline remains 120 substeps / AT;
- default visual duration is 800ms / AT;
- the debug Timebase may adjust visual duration from 250ms to 1600ms / AT in 50ms steps;
- this slider must never alter solver results, distances, Velocity, Momentum or Thermal result after one AT;
- final logical state commits only after the configured visual duration finishes.

Thermal uses the same fractional AT playback clock:

- one complete thermal oscillation cycle = 8 AT;
- one half swing = 4 AT;
- the pendulum must visibly evolve continuously during a movement AT instead of updating only at action completion;
- changing real-time / AT therefore speeds or slows movement and pendulum presentation together without changing AT-space behavior.

## Playback stability

- do not auto-follow or auto-zoom the actor during an action;
- camera zoom/orbit input is frozen while playback is active;
- defer ResizeObserver-driven viewport changes until playback ends so Three.js projection and canvas geometry do not breathe or subtly scale during motion.

## Hard constraints

Do not reintroduce any active runtime, compatibility layer, or movement authority based on:

- Square4;
- UT5 / UT6 / UT7 historical playgrounds;
- Reachable Field endpoint selection;
- target-cell pathfinding movement;
- `InertiaFieldBoard`;
- old Cell-center Hybrid waypoint simplification;
- segmented actor playback;
- Apply / Confirm movement buttons;
- automatic per-AT Momentum spending just because movement occurred.

Historical code remains recoverable from `backup/pre-rebuild-2026-08-22`. Reuse a historical presentation idea only when it can be expressed through the current shared solver contract.

## Movement architecture

- Deterministic and side-effect-free solver.
- Preview and execution use the exact same samples.
- One action resolves exactly 1 AT.
- Current baseline: 120 simulation substeps / AT.
- Default visual baseline: 800ms / AT, adjustable only as presentation speed.
- Do not commit final logical Position before visual playback completes.
- Renderer consumes solver trajectory samples; it does not infer a new route after state mutation.
- Hex Cell and M are derived views, not Hybrid movement authority.
- Collision response operates on physical movement Velocity; never pathfind around collision.

## Validation order

Until movement feel is accepted, prioritize:

1. Basic Move + inertia interaction;
2. Drive / Heavy Drive exact vector-sum turning;
3. Hybrid curve readability without mathematical contamination;
4. immediate-direction preview readability;
5. AT playback speed and camera stability;
6. Thermal synchronization to fractional AT;
7. Coast / Counter / Hard Turn;
8. hard-surface / boundary collision;
9. only then deepen Thermal and later tactical systems.

Do not expand enemy AI, deckbuilding, equipment, or session economy to compensate for unresolved movement feel.
