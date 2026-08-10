# UT4 Validation Matrix

The first implementation targets all P0 contracts and the highest-value P1 diagnostics from the ProjectC UT4 handoff.

| Design case | First prototype path |
| --- | --- |
| T1 Damping / Settle | Thermal Debug + Step/Auto Run |
| T2 Set Point bias | Set Point slider |
| T3 Domain hysteresis | Temperature quick set / slider + Spatial Debug |
| T4 Hot Movement build | T +4 + Basic Move / Drive |
| T5 Steering / Brake | Drive direction changes + Brake |
| T6 Drive obstacle | Axis Drive through Dummy / surfaces |
| T7 Cold stationary build | T -4 + Hold / stationary weapon |
| T8 Cold interrupted by Neutral | Thermal drift + stationary action |
| T9/T10 Cold hold vs hit | Position M quick set + Inject Hit |
| T11 Heavy Release | Position M + Heavy Release |
| T12 Attack vs Occupancy | Default Weapon vs Basic Move into occupied Cell |
| T13 Hot vs Cold contest | Player/Dummy Spatial Debug + Move |
| T14 Same-AT contest | Queue Dummy Move + player action / Step |
| T15 Secondary conflict | Heavy Release / forced motion into Dummy or surface |
| T16 Full cycle | Thermal/Spatial controls + normal actions + Auto Run |

P2 actions such as Sweep and complex continuous reflection are intentionally excluded from this slice.
