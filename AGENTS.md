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

Drive actions are free-direction impulses:

```text
V_after = clamp(V_before + ΔV_aim)
```

- Drive `|ΔV| = 0.85`;
- Heavy Drive `|ΔV| = 1.35`;
- there is **no pre-impulse steering-angle legality check**;
- the resulting direction is whatever vector addition produces.

### Counter / Hard Turn / Coast

- Counter Impulse keeps its reverse-direction semantic and may enforce a reverse aim window.
- Hard Turn is a smaller free-direction correction impulse.
- Coast applies no new impulse and preserves current Velocity.

## Spatial A/B

Discrete and Hybrid are intentional comparison modes in the current lab. They share:

- the same board;
- the same actions;
- the same Aim Cell input;
- the same fixed 1 AT clock;
- the same delayed logical-state commit rule.

Discrete presents the result through Cell-centered movement steps.

Hybrid resolves continuous Position / Velocity. When an impulse changes heading, its sampled path may bend continuously from the incoming Velocity tangent toward the mixed outgoing Velocity tangent. This curve is part of the solver samples consumed by both preview and playback; it must not be invented later by the renderer.

## Momentum visualization

- the yellow Axis arrow means **direction only** and uses a fixed visual length;
- the three actor dots alone encode M1 / M2 / M3 magnitude;
- do not scale the Axis arrow by Momentum level.

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
- Current visual baseline: 800ms / AT, independent of distance or sample count.
- Do not commit final logical Position before visual playback completes.
- Renderer consumes solver trajectory samples; it does not infer a new route after state mutation.
- Hex Cell and M are derived views, not Hybrid movement authority.
- Collision response operates on movement vectors; never pathfind around collision.

## Validation order

Until movement feel is accepted, prioritize:

1. Basic Move + inertia interaction;
2. Drive / Heavy Drive free impulse turning;
3. Hybrid curve readability;
4. Coast;
5. Counter Impulse;
6. Hard Turn;
7. hard-surface / boundary collision;
8. only then deepen Thermal and later tactical systems.

Do not expand enemy AI, deckbuilding, equipment, or session economy to compensate for unresolved movement feel.
