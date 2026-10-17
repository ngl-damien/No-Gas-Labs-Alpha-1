# Cancelled movement must not become arrival

The shared browser journey exposed an artifact sheet reopening after manual keyboard movement. `WorldView` cleared its route but retained the destination ID. Its next update interpreted the empty route as completed arrival and invoked `onInteract` immediately, even though the player had abandoned that destination. Touch input and restored player coordinates had the same mismatch.

`game/world-view.mjs` now cancels both route and arrival target together for keyboard movement, nonzero touch input, and coordinate restoration. Zero touch input leaves a valid route intact. Normal completed routes still interact once.

The focused regression in `test/game-geometry.test.mjs` runs the real constructor, keyboard handler, touch setter, position setter, routing, and update loop with minimal browser host stubs. Before the production fix, all three cancellation regressions failed with an unexpected workbench interaction; the normal-arrival control passed. After the fix, `node --test test/game-geometry.test.mjs` passed all eight tests. These checks cover route behavior, not rendering or end-to-end browser input; root browser verification remains separate.

No emission-throttle changes were made. Presence still emits moving positions at its existing interval; this report does not claim a final stopped-position flush.
