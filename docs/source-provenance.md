# Source provenance

The public repository is a source snapshot of the new Never86 CostProof competition application. Publication creates a new public repository history. Its first public commit is not the original time each local file was developed.

The reviewed local application snapshot is commit `8856f8473f60f2326f2dca08e431ee8dda044c64`, recorded October 21, 2026 at 9:48:56 p.m. Central, or October 22 at 02:48:56 UTC. The workflow and this provenance note were prepared afterward. Local development history is retained separately. The dated [prior work declaration](preexisting.md) and [competition window record](build-window.md) describe the prewindow baseline and later application work. These local hashes are provenance references, not a claim that the separate public history contains those commits.

Prior work includes restaurant operating knowledge, Brain and Mini Brain doctrine, the specification and synthetic inputs, sponsor setup, and the disclosed unmodified public Meterless starter and H-MEM reference. The sponsor reference remains pinned to upstream commit `1742dec56a66e58eef9dda2d2b865823758ca8cd` with its Apache 2.0 license. Existing private Action Shift or Command Center source, private Brain corpus, customer operating records, runtime configuration, credentials and account recovery material are excluded from the public snapshot. Synthetic source records and deterministic examples are labeled explicitly.

The local application record reports 42 passing checks and three passing deterministic sample contracts before publication. Those are local results. The GitHub Actions workflow must run on the published snapshot before any CI pass is claimed. It runs the application suite and the complete, missing wage and restaurant mismatch replays on Ubuntu with Node.js 24. It requires no repository secrets, write permissions, paid runner features, live Zetaris query or Nightshift model call. Passing CI does not establish live sponsor integration, model accuracy, customer acceptance or recovered savings.

The workflow requests only `contents: read`, disables persisted checkout credentials and does not publish artifacts or deploy anything. Action versions were checked against the official repositories and release tags on October 22, 2026 and pinned to full commits:

- [actions/checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1): `3d3c42e5aac5ba805825da76410c181273ba90b1`.
- [actions/setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0): `949feb2413d6458794dcd2491c4babbbce0c15c1`.

The workflow uses ordinary `push` and `pull_request` events and an optional manual run. It does not use a privileged pull request trigger. Recheck upstream releases before changing the pinned action commits.
