# VAL-012-UT4 Coupled Inertia Sandbox

This prototype slice implements the 2026-08-11 ProjectC UT4 handoff in the Inertia Lab route.

The active lab validates one Spatial Inertia resource with Movement and Position modes coupled to a damped Thermal Inertia solver. It provides direct Thermal/Spatial state construction, manual hits, manual AT stepping, axis-committed Drive, weapon-defined attacks, Hold Position, Heavy Release, Cell Contest, AI-off dummies, queued dummy movement, and causal logs.

Authoritative design references remain in `i-scan/ProjectC`:

- `docs/VAL-012-thermal-clock-action-time-prototype-plan.md`, revision 5
- `docs/VAL-012-unified-time-system-program-handoff.md`, UT4

UT3 source remains available for regression/reference, but the primary Inertia Lab route is UT4.
