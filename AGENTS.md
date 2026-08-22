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

Discrete and Hybrid are intentional comparison modes in the current lab. They share the same board, actions, Aim Cell input, fixed 1 AT logical cost and delayed logical-state commit rule.

Discrete presents the result through Cell-centered movement steps.

Hybrid resolves continuous Position / Velocity. When an impulse changes heading, its sampled path may bend continuously from incoming Velocity toward mixed outgoing Velocity. Curve geometry is presentation / path shape only; it must not contaminate the physical resultant Velocity or collision response.

## Axis / Momentum visualization

The Axis HUD intentionally reuses the mature pre-rebuild presentation language:

- **Horizontal Axis**: a short, thin yellow screen-space arrow. It encodes direction only and does not grow with M;
- **M0**: an explicit neutral M0 marker remains visible instead of hiding Axis UI entirely;
- **Down M**: the cyan ring / downward anchor marker represents the old Grounded / Position Authority axis. Down M is **not downward Velocity** and must not be inserted into the current 2D Position/Velocity movement solver;
- the current driving lab exposes Down M1–M3 only as an Axis Indicator visual preview until the actual Grounded mechanics are reconnected;
- the three actor dots remain the magnitude encoding for M1 / M2 / M3.

Do not replace this HUD with a large world-space arrow unless the user explicitly asks to abandon the previous visual language.

## Steering preview

The prediction line is a steering / direction guide, not a full route annotation:

- short horizon, about 1.55 world units;
- thick-enough dashed segments for readability;
- begins from current movement heading when one exists;
- rotates smoothly along the shortest turn toward the resulting movement direction;
- may therefore show a curve in both Discrete and Hybrid modes;
- it must not imply that every displayed point is an authoritative Cell path or destination.

## AT / Thermal timebase

Logical time and playback seconds are separate:

- one action always costs exactly 1 AT;
- solver baseline remains 120 substeps / AT;
- default visual duration is 800ms / AT;
- debug Timebase may adjust visual duration from 250ms to 1600ms / AT in 50ms steps;
- this slider must never alter movement solver results or the one-AT Thermal result;
- final logical state commits only after configured visual playback finishes.

Thermal uses one continuous damped-oscillator model in AT space:

- one complete visible oscillation = 8 AT;
- one half swing = 4 AT;
- fractional playback samples are analytic, not frame-rate or substep dependent;
- do not reintroduce `ceil(progress * substeps)` resampling of the whole interval, which caused repeated left/right numerical jitter inside one AT;
- the pendulum evolves continuously during movement playback and uses the same fractional AT clock as movement.

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
- One action resolves exactly 1 AT.
- Current baseline: 120 simulation substeps / AT.
- Default visual baseline: 800ms / AT, adjustable only as presentation speed.
- Do not commit final logical Position before visual playback completes.
- Renderer consumes solver trajectory samples; it does not infer destination movement after state mutation.
- Hex Cell and M are derived views, not Hybrid movement authority.
- Collision response operates on physical movement Velocity; never pathfind around collision.

## Validation order

Until movement feel is accepted, prioritize:

1. Basic Move + inertia interaction;
2. Drive / Heavy Drive exact vector-sum turning;
3. Hybrid curve readability without mathematical contamination;
4. Horizontal / M0 / Down Axis HUD readability;
5. steering-preview turn readability;
6. AT playback speed and camera stability;
7. Thermal synchronization without intra-AT numerical jitter;
8. Coast / Counter / Hard Turn;
9. hard-surface / boundary collision;
10. only then deepen Thermal and later tactical systems.

Do not expand enemy AI, deckbuilding, equipment, or session economy to compensate for unresolved movement feel.
