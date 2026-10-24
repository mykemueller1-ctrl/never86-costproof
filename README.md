# Never86 CostProof

See the dollar gap. Check the records. Decide the next step.

Public development repository: [mykemueller1-ctrl/never86-costproof](https://github.com/mykemueller1-ctrl/never86-costproof). This Node application is the competition build. A limited synthetic integration demo passed on the development machine on October 24 UTC. The entry remains a development draft; final assets, review and portal submission are separate. [Source provenance](docs/source-provenance.md) distinguishes this revision from prior local development.

This new competition application investigates a restaurant labor target variance. It reconciles a synthetic $600 gap, shows the separate records, rejects scope mismatches and stops dollar conclusions when wages are missing. Real Meterless H-MEM stores reviewed manager reports with provenance and fresh-process recall. An actual full application probe and a separate browser UI run passed the current integration gate with real local Zetaris queries and Nightshift planning, typed fact selection and critique. The UI result also passed manual review for the limited synthetic demo. This establishes the observed integration, not customer outcomes, reliable completion of every possible question or final-entry readiness.

## Run the current build

Use Node.js 24 or newer. There are no package dependencies beyond the checked-in, unchanged Meterless H-MEM reference.

```powershell
node --experimental-transform-types src/server.mjs
node --experimental-transform-types --test --test-concurrency=1 test/*.test.mjs
node --experimental-transform-types src/sample-run.mjs
```

Open `http://127.0.0.1:4317` in Chrome. The service binds only to loopback. Optional local configuration goes in `.env`, based on `.env.example`; credentials and `.costproof/` are ignored by Git. Do not put credentials into the browser or a public repository.

The default is **Deterministic preview** over labeled synthetic source files. Select missing wages, a mismatched restaurant or zero sales to inspect refusal and denominator behavior. Review the synthetic manager statement before saving it to H-MEM, then run again. The proposed action changes, while payroll stays unchanged. The trace contains original rows, integer-cent inputs, scope and memory audit.

**Nightshift investigator + critic** requires a real local runtime, valid token and installed provider model. The app discovers routing IDs and runs model-based source planning. The model then selects stable accounting fact IDs and an eligible next check. Code binds exact amounts, units, scope and sources from validated records, checks them and renders canonical wording with every required limitation. The model does not copy quantities or source IDs; unexpected numeric/source payloads are refused. Raw model selections remain unchanged in the trace. A mandatory relevance/evidence critic gets at most two review attempts. An approving critic cannot override code guards and is not an independent factual verifier. An unavailable or unauthorized model returns an explicit error. The version-scoped [Nightshift provider guide](docs/nightshift-provider.md) documents the primary HTTP route, fresh request scopes, strict structured responses and conservative selection of a Runtime-preserved draft when MoA has replaced it. Tests use a marked stub for orchestration and HTTP contract checks; those tests do not establish live sponsor integration.

The **Evidence source** selector separates local fixtures from registered Zetaris records. The adapter supports explicit direct REST or ordinary-login UI proxy transport; both require reviewed source mapping proof, exact column projection and scope validation. Source errors propagate and cannot fall back to fixtures. Fixture fault scenarios cannot alter registered records. The October 24 accepted integration runs used the local Zetaris UI proxy: all three scoped synthetic families returned HTTP 200, the $600 gap reconciled as $0 + $420 + $180, and actual Nightshift stages passed. Direct REST support has contract tests; these observed live runs establish UI proxy execution. The browser clears its current-run verification when the mode changes. Read [the provider setup](docs/zetaris-provider.md) before configuring it.

Local validation on October 22 UTC included a real H-MEM write and recall in a new Node process and real ephemeral HTTP requests to the synthetic source helper. The current suite passes 84 checks, and the [three deterministic sample replays](examples/README.md) pass complete, missing wages and wrong restaurant contracts with structured receipts and traces. Tests and samples do not call a live model or establish sponsor integration. The separately observed October 24 integration used Nightshift 1.2.1 and a derived local NVIDIA Nano model at 4,096 context tokens and one slot. The provider guide distinguishes the publisher original from the metadata-only derived file. Earlier failures are retained in the private development record; they are not relabeled as successful runs. The core calculation module was entered and saved in Cursor during the build window; Cursor model usage is unverified. Development assets have been saved to HackOS; final deck/video review and final submission remain separate.

CostProof draws on Never86's prior Brain and Mini Brain operating doctrine: scope each finding to its restaurant and shift, reconcile source records, retain reviewed corrections and propose one check with the evidence needed. Those ideas and restaurant experience predate the hackathon and are declared prior research. This competition application uses labeled synthetic records and the disclosed public Meterless reference. It contains no private Brain corpus, customer records or existing private product source.

## Development boundary

The official build window started October 22, 2026 at 00:00 UTC. Commits through `8081f69` are prewindow preparation and are declared in [prior work](docs/preexisting.md). Application files in `src/`, `public/` and `test/` were started after the opening. No existing private Never86 product source is included.

## Current working foundation

The public Meterless H-MEM reference has been exercised locally. A synthetic manager note was stored, recalled in a separate Node process and inspected through its audit ledger. This is a sponsor reference smoke check, not acceptance of the restaurant workflow.

Using Node 24.19.0 from this environment:

```powershell
Set-Location sponsor-starter
$env:ANTHROPIC_API_KEY = ''
node --experimental-transform-types notebook.ts remember "Synthetic restaurant note for local testing"
node --experimental-transform-types notebook.ts ask "What is the synthetic restaurant note?"
node --experimental-transform-types notebook.ts audit mem-1
```

The default starter is retrieval only. No model, external tenant or production data is used by these commands. The Node type transformation flag is experimental. A normal tsx setup is also described in the sponsor's unchanged README. The local `npm` command is unavailable; the smoke check used the installed Node runtime directly.

## Verify the live workflow

Run `node --experimental-transform-types src/live-run.mjs` after the real local Zetaris and Nightshift services are configured. It executes the existing application path and writes a pass-or-blocked receipt with the actual returned trace. Fixture sources, injected test transport and discovery without model text cannot pass. See [live acceptance](docs/live-acceptance.md) for requirements and the four-minute deadline.

The current local suite passed **84 checks on October 24 UTC**, including live-receipt gates, typed decision/rendering bindings, strict model contracts, request-scope isolation and preserved-draft refusal cases. The gate checks both supported Zetaris transports and requires actual Nightshift planning, fact selection and accepted critique. A source-only reconciliation and an offline replay of captured model text cannot pass. The full probe and separate UI run passed that gate; the UI result was manually accepted for the limited synthetic demo. Original provider finish status and raw usage of any selected Runtime-preserved draft remain unknown, as [documented](docs/nightshift-provider.md). The published baseline commit `f3a1cc4` passed [GitHub Actions](https://github.com/mykemueller1-ctrl/never86-costproof/actions/runs/39729434110); this historical result is not a CI claim for the current revision. The live command reports a blocked receipt when required local configuration is absent.

Use the [current demonstration script](docs/demo-script.md) and [current pitch deck](docs/CostProof_Pitch.pptx). They match this application's $420 plus $180 bridge, reviewed manager context and unsent proposed action. Do not substitute a separate Python prototype's arithmetic or action-state claims.

## Finish the entry

Read [the specification](docs/prd.md) and [Cursor kickoff](docs/cursor-kickoff.md). The [synthetic HTTP source helper](docs/zetaris-fixture-http/README.md) supplies independent labeled endpoints. The limited live integration has passed; final video, factual deck review, publication verification and portal submission remain separate tasks. The observed manager report was recalled as unverified context. No counterfactual live run established that memory changed the chosen action. The proposed check remains unsent; no customer savings or causal staffing conclusion is established.

This revision is prepared on the existing public parent `f40d7e5f75675163f29b43cf1902e77b27a5e2bd` from the reviewed local implementation `2a9323c233418eba76f6b6b1c07d08a8646e718c`. Only the reviewed application/test/documentation delta is included; vendor files and prior public history are retained. Local and public histories are not merged or force-pushed. Private execution receipts, runtime configuration and model files are excluded. A local preparation or commit does not establish remote publication or CI success.

Public starter source: Meterless/Meterless commit `1742dec56a66e58eef9dda2d2b865823758ca8cd`. The starter and vendored reference retain the sponsor's Apache 2.0 license. No separate license for the new application has been selected. The public source is a development snapshot, with prior work disclosed.
