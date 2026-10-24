# Nightshift provider contract

This guide describes the CostProof adapter tested with **Nightshift 1.2.1** and one local NVIDIA Nano route. On October 24, 2026 UTC, an actual full application probe and a separate browser UI run passed the current Zetaris + investigator + critic gate. The UI result was manually accepted for the limited synthetic demo; customer outcomes and final-entry readiness are not established. The local suite passed 84 checks and three deterministic sample contracts. Those tests and an offline captured-response replay are adapter evidence, separate from the observed live runs. The preserved draft's original provider finish status and raw usage remain unknown as described below.

## Configure the primary HTTP path

Use an existing authorized Nightshift installation and its ordinary model setup. Configure the local ignored `.env` with an existing runtime token and these nonsecret settings:

```dotenv
METERLESS_BASE_URL=http://127.0.0.1:8088/v1
METERLESS_MODEL=meterless/local
```

Set `METERLESS_RUNTIME_TOKEN` privately. `.env.example` defaults to `meterless/auto`, so explicitly choose `meterless/local` for this verified local setup. Set the existing CostProof application to Local through Nightshift's normal controls. Confirm the model is Ready through the installed runtime before requesting analysis; memory admission failures must be resolved before retrying.

CostProof calls `GET /v1/models` and `POST /v1/chat/completions` on loopback. It does not bypass Nightshift by sending application inference directly to the underlying model server. Requests retain the application `never86-costproof`, tier splitting off, and a new `costproof-request-<UUID>` scope generated once per call and recorded in its receipt. Fresh scopes isolate prior Runtime answer recall; they do not disable Runtime storage, learning or autosave. Reviewed CostProof H-MEM manager reports remain explicit untrusted context in the evidence packet.

The verified provider route is:

```text
local-runtime/nvidia-llama-3-1-nemotron-nano-4b-v1-1-q4-k-m
```

The observed model configuration is **4,096 context tokens, one slot**. This is the tested runtime configuration, not the model's advertised maximum context. The app's first system message is exactly `detailed thinking off`; trusted task policy is in a separate user-envelope field from untrusted source data. Requests use greedy decoding and stage-specific strict JSON schemas, with output caps of 128 tokens for planning, 1,024 for explanation and 512 for critique. See the pinned [NVIDIA model card](https://huggingface.co/nvidia/Llama-3.1-Nemotron-Nano-4B-v1.1/blob/d552708a9d575fa8d4a690b988fd870d65279f98/README.md) for its prompt conventions. Structured generation is still checked by application code.

## Select a preserved draft without repairing an answer

Observed Nightshift 1.2.1 buffered responses may adopt a later Mixture-of-Agents (MoA) synthesis that does not retain the initial structured response contract. The same primary HTTP response includes the initial text as `meterless.receipt.synthesis.superseded = { model, text }`. CostProof reads that returned field; it does not patch Nightshift, invent an opt-out parameter or reconstruct missing JSON.

For every schema task with adopted synthesis or a superseded record, the adapter always selects the preserved draft before parsing, even when the final synthesized content is valid JSON. It requires:

- Matching response/request, receipt and decision identifiers; the actual sent app and scope; the requested model and Local mode in the returned receipt views.
- The exact verified Nano model and `local-runtime`/local winning route in both views, a local Nano aggregator and an all-Nano panel, with synthesis explicitly run and adopted.
- Final message text equal to the recorded synthesis text, no selected quality-vote replacement and no optimistic upgrade.
- Exactly an initial `final_synthesis` followed by `moa_synthesis`, with matching models and token counts in both receipt views. The initial output count must be a positive integer strictly below that request's output cap.

These are receipt-consistency checks, not a cryptographic provider-completion attestation. Runtime phase token counts may be estimates. A count below the cap does not prove a measured normal stop.

Successful selection records `model_text_source: runtime_preserved_draft`, `original_draft_model`, the Runtime receipt/decision identifiers and `original_draft_phase_tokens`. The selected `finish_reason`, `usage`, `original_draft_finish_reason` and `original_draft_usage` are **null**: Nightshift does not export the original provider finish status or raw usage with the preserved text. `gateway_finish_reason` and `gateway_usage` retain final gateway metadata separately; aggregate usage can include multiple generations. A gateway `stop` is not the original draft's stop, and aggregate tokens are not one generation's context size.

Missing or inconsistent provenance, another local model, a mixed panel, extra phases, unknown counts or a reached token bound cause `MODEL_PRESERVED_DRAFT_UNVERIFIED`. An explicit reported `length` causes `MODEL_OUTPUT_TRUNCATED`, even for parseable JSON. Malformed/non-object JSON causes `MODEL_INVALID_JSON`; schema violations cause `MODEL_SCHEMA_INVALID`. A positive reported Runtime memory-injection count causes `MODEL_MEMORY_SCOPE_CONTAMINATED`; missing metadata remains null. There is no fallback from a refused draft or a semantic rejection to the synthesized final answer.

Every selected draft still passes strict selection validation and mandatory model critique. The claim contract has two complete `oneOf` branches: `{kind: metric_observation, metric_key}` selects one available catalog ID; `{kind: accounting_bridge, component_key}` selects one of the three bridge component IDs. Code binds the latter to the unique gap and component. Amounts, units, scope, source IDs and numeric-reference arrays are not model-output fields. Any supplied old numeric/source payload is rejected rather than copied or repaired.

Code resolves references from the validated catalog, runs the exact value/unit/full-scope/source guards and records them separately as `fact_binding/catalog_resolution`. Every required limitation ID and a closed next-check kind with eligible report IDs remain mandatory. There is no freeform assertion or action-text field. Code supplies fixed accounting wording, values, the unverified-cause statement and all deterministic limitations. `analysis.rendering` identifies `code_from_validated_model_selection`; `analysis.reference_binding` identifies `code_from_validated_catalog`. The trace retains raw selectors and critic responses unchanged. The critic reviews relevance and evidence but cannot override code guards. Citation IDs alone do not prove semantic support. A negative critic, missing evidence or invalid binding remains a refusal. Other Nightshift versions or response shapes need new source and captured-response review before this path can be claimed supported.

## Reproduce the model artifact without overwriting originals

The tested model is NVIDIA's [Llama-3.1-Nemotron-Nano-4B-v1.1 at revision `d552708a9d575fa8d4a690b988fd870d65279f98`](https://huggingface.co/nvidia/Llama-3.1-Nemotron-Nano-4B-v1.1/tree/d552708a9d575fa8d4a690b988fd870d65279f98), quantized by [bartowski at revision `4eb0ffaec9b21a411cf4fa39df2fba0b7a972e11`](https://huggingface.co/bartowski/nvidia_Llama-3.1-Nemotron-Nano-4B-v1.1-GGUF/tree/4eb0ffaec9b21a411cf4fa39df2fba0b7a972e11). Obtain the [pinned Q4_K_M artifact](https://huggingface.co/bartowski/nvidia_Llama-3.1-Nemotron-Nano-4B-v1.1-GGUF/resolve/4eb0ffaec9b21a411cf4fa39df2fba0b7a972e11/nvidia_Llama-3.1-Nemotron-Nano-4B-v1.1-Q4_K_M.gguf) under its applicable NVIDIA and Llama license terms. Weights are not included in this repository.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Publisher Q4_K_M original | 2,778,285,600 | `530f0e0ade58d22d4b24d9378cf8a87161d22f33cae8f2f65876f3a1555819e6` |
| CostProof metadata-only derived copy | 2,778,285,632 | `b715be724a9672e915669f17dc14335eff0548db6be6a4a4e069b054863279ed` |

The embedded chat template lacked one closing object brace in its assistant tool-call loop. Against the extracted original `tokenizer.chat_template`, insert `{{- '}' -}}` immediately after the tool-call arguments branch's `{%- endif -%}` and before `{{- ', ' if not loop.last else '' -}}`. Apply this only at that exact loop location, with exactly one match. Do not replace the whole template with a newer upstream variant. The extracted original template SHA-256 is `8d9f2720d2f960f2ade57096cdf3be2e6b471e6371acf81b88dd5e3c3393dabb`; the corrected template is `6aac03dd36e82cd886e0688eaa7701212bab69f5960c34af491e2a85b23c9f37`.

Use the matching official `gguf-py` package from [llama.cpp commit `1a24df163920a4744a95373d178d790b72a9bb2f`](https://github.com/ggml-org/llama.cpp/tree/1a24df163920a4744a95373d178d790b72a9bb2f/gguf-py) and its unmodified [metadata writer](https://github.com/ggml-org/llama.cpp/blob/1a24df163920a4744a95373d178d790b72a9bb2f/gguf-py/gguf/scripts/gguf_new_metadata.py). Write a distinct new output file, with no `--force`:

```powershell
python -m gguf.scripts.gguf_new_metadata INPUT.gguf NEW-DERIVED.gguf --chat-template-file costproof-one-brace.jinja
```

Before activation, independently verify the original whole-file hash is unchanged, the derived hash/size match, and only `tokenizer.chat_template` changed. The recorded comparison found all **292 tensor descriptors and payload hashes identical**, and all **45 other typed metadata values identical**. No-tools message rendering and the explicit nonreasoning system directive were preserved. The one-brace change addresses the demonstrated template error; it is not an inference-accuracy guarantee.

Keep the publisher file and its provenance intact. Choose the separately verified derived file through ordinary model setup, then confirm actual model identity, context, slot count and readiness. This guide does not copy files into active folders, overwrite models or change runtime settings. No proprietary Nightshift source, runtime credentials, private machine paths or model weights are distributed here.

## Acceptance

Follow [live acceptance](live-acceptance.md) only after source setup and model readiness. A real source-only reconciliation, model readiness, HTTP 200, schema-valid JSON, local tests and an offline response replay are distinct observations. A complete accepted live result requires all source receipts plus actual planning, explanation, valid accounting claims and accepted critique in the application.
