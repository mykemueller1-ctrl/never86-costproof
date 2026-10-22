# Deterministic sample replays

Run these commands from the CostProof project folder with Node.js 24 or newer:

```powershell
node --experimental-transform-types src/sample-run.mjs
node --experimental-transform-types src/sample-run.mjs --scenario complete
node --experimental-transform-types src/sample-run.mjs --scenario missing-wages
node --experimental-transform-types src/sample-run.mjs --scenario mismatched-restaurant
```

The default runs all three cases. It prints one JSON receipt per case and writes a receipt, full returned investigation and index into a new dated folder under `.costproof/samples/`. That directory is ignored by Git.

To choose an explicit destination, use a new folder name:

```powershell
node --experimental-transform-types src/sample-run.mjs --output-dir .costproof/samples/replay-001
```

Existing output files are not overwritten. Use `--help` for the command shape. Unsupported scenarios, unexpected application behavior, failed assertions or output errors exit with a nonzero status. The expected mismatched restaurant refusal is a passing contract and exits successfully.

| Case | Expected receipt |
| --- | --- |
| `complete` | `reconciled`, exactly `60000` cents |
| `missing-wages` | `held`, no dollar metrics or bridge, a request for the wage record |
| `mismatched-restaurant` | `refused`, `SCOPE_MISMATCH` identifies the restaurant join key |

The CLI calls the existing `investigate` function. It selects local synthetic fixtures, disables model mode, rejects fetch and model calls, and uses a fresh isolated H-MEM store for every invocation. It does not read a saved manager report or the normal application memory directory. It does not query Zetaris or call Nightshift.

For successful returns, the trace file includes the complete application result and its actual trace. For a mismatched restaurant, `investigate` throws before returning its internal trace. That artifact preserves the actual invocation, error code, mismatch detail and refusal without inventing unavailable steps.

The captured JSON files under `captured-2026-10-22/` are dated deterministic fixture outputs from this command. They are examples of local behavior, not live sponsor evidence, customer outcomes, causal explanations or recovered savings. The fixture's synthetic shift date is separate from the receipt creation time.
