# Never86 CostProof

See the dollar gap. Check the records. Decide the next step.

Public development repository: [mykemueller1-ctrl/never86-costproof](https://github.com/mykemueller1-ctrl/never86-costproof). The entry remains a development draft; live sponsor workflow and final submission are pending. [Source provenance](docs/source-provenance.md) distinguishes the published snapshot from prior local development.

This new competition application investigates a restaurant labor target variance. A working local preview now reconciles a synthetic $600 gap, shows the separate records, rejects scope mismatches and stops dollar conclusions when wages are missing. Real Meterless H-MEM stores reviewed manager reports with provenance and fresh-process recall. A live Nightshift model and real Zetaris queries are still pending. The entry remains a draft.

## Run the current build

Use Node.js 24 or newer. There are no package dependencies beyond the checked-in, unchanged Meterless H-MEM reference.

```powershell
node --experimental-transform-types src/server.mjs
node --experimental-transform-types --test test/*.test.mjs
node --experimental-transform-types src/sample-run.mjs
```

Open `http://127.0.0.1:4317` in Chrome. The service binds only to loopback. Optional local configuration goes in `.env`, based on `.env.example`; credentials and `.costproof/` are ignored by Git. Do not put credentials into the browser or a public repository.

The default is **Deterministic preview** over labeled synthetic source files. Select missing wages, a mismatched restaurant or zero sales to inspect refusal and denominator behavior. Review the synthetic manager statement before saving it to H-MEM, then run again. The proposed action changes, while payroll stays unchanged. The trace contains original rows, integer-cent inputs, scope and memory audit.

**Nightshift investigator + critic** requires a real local runtime, valid token and installed provider model. The app discovers routing IDs, runs model-based source planning, and gives the evidence critic at most two review attempts. Exact numeric values, units, scope and source coverage are checked outside the model. The critic still reviews causal and qualitative support; it is not an independent factual verifier. An unavailable or unauthorized model returns an explicit error. Tests use a marked stub for orchestration and HTTP contract checks; those tests do not establish live sponsor integration.

The **Evidence source** selector separates local fixtures from registered Zetaris records. The local REST adapter and application provider require explicit source mapping proof, exact column projection and scope validation. Source errors propagate and cannot fall back to fixtures. Fixture fault scenarios cannot alter registered records. Read [the provider setup](docs/zetaris-provider.md) before configuring it. No actual Zetaris query has succeeded in this environment.

Local validation on October 22 UTC: 42 checks passed, including a real H-MEM write and recall in a new Node process and real ephemeral HTTP requests to the synthetic source helper. The [three sample replays](examples/README.md) pass complete, missing wages and wrong restaurant contracts and write structured receipts plus traces. Nightshift 1.2.1 is installed: a real invalid token was rejected and valid model discovery returned 18 routing IDs. The first real text call returned `no_provider_configured`; no model inference is claimed. The core calculation module was entered and saved in Cursor during the build window; Cursor model usage is unverified. A seven slide editable development draft deck is uploaded to the saved HackOS draft. No final entry has been submitted.

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

## Build next

Read [the specification](docs/prd.md) and [Cursor kickoff](docs/cursor-kickoff.md). Complete Windows WSL/Docker startup and the real Zetaris source query. The [synthetic HTTP source helper](docs/zetaris-fixture-http/README.md) prepares three independent endpoints and an unexecuted registration plan. Finish installing a local Nightshift model and capture an actual text response. Then validate the investigator and critic against those real connections before recording the final video and finalizing the deck and repository.

Public starter source: Meterless/Meterless commit `1742dec56a66e58eef9dda2d2b865823758ca8cd`. The starter and vendored reference retain the sponsor's Apache 2.0 license. No separate license for the new application has been selected. The public source is a development snapshot, with prior work disclosed.
