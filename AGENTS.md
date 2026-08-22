# ProjectC Web Prototype Instructions

## Active scope

Only the continuous inertia rebuild on `main` is active.

Authoritative movement state:

```text
Position(x,z) + Velocity(x,z)
```

User input:

```text
Card + Aim Cell → Impulse → resolve fixed 1 AT
```

A clicked Cell defines aim and immediately resolves the action. It is never a requested destination.

## Hard constraints

Do not reintroduce any active runtime, route, compatibility layer, test gate, CSS dependency, or renderer for:

- Square4;
- UT5 / UT6 / UT7 historical playgrounds;
- Reachable Field A/B;
- Target-cell pathfinding movement;
- Basic Move destination selection;
- Discrete / Hybrid gameplay modes;
- InertiaFieldBoard;
- segmented actor playback;
- Apply / Confirm movement buttons;
- Graphics Lab as an active route.

Historical code is recoverable from `backup/pre-rebuild-2026-08-22` and `archive/all-legacy-2026-08-22`; do not copy it into `main` just for compatibility.

## Movement architecture

- The continuous solver is deterministic and side-effect free.
- Preview and execution use the exact same solver.
- One action always resolves exactly 1 AT.
- Current baseline: 120 simulation substeps / AT.
- Current visual baseline: 800ms / AT, independent of distance or waypoint count.
- Do not commit final logical Position before visual playback completes.
- Renderer consumes continuous trajectory samples; it does not invent a path after state mutation.
- Hex Cell and M are derived views, not movement authority.
- Collision response operates on continuous Position / Velocity; never pathfind around collision.

## Validation order

Until movement feel is accepted, keep scope narrow:

1. Drive / Heavy Drive;
2. Coast;
3. Counter Impulse;
4. Hard Turn;
5. hard-surface / boundary collision;
6. only then reconnect Thermal and later tactical systems.

Do not expand weather, enemy AI, deckbuilding, equipment, or session economy to compensate for unresolved movement feel.
