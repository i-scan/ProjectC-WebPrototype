# Trajectory Lab cell authority fix

This temporary review note records the focused correction requested during first-pass testing.

- The Hex board remains Cell-authoritative.
- Continuous Process Steering samples exist only inside one Action / 1 AT transition.
- The continuous endpoint is used to derive a Landing Cell, then Ready settles exactly at that Cell center.
- Move / Steer no longer requires a separate Commit button: select the action, hover for preview, click a Cell once to execute.
- Coast / Wait still executes directly because it has no directional target.

The review note can be removed after merge; runtime/test files are authoritative.
