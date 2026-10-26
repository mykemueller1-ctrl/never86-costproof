# Void Hunter evidence demonstration

This is a new, bounded competition workflow written on October 26, 2026. The restaurant operating idea predates the build. The implementation and fictional inputs are new work. No private Brain corpus, current employee records, customer POS data or existing private product source was copied.

The workflow answers two separate questions:

1. What void counts, recorded cents and original-order rates are supported for a complete week or month?
2. Which source observations exist for one modifier request, POS dispatch, kitchen acknowledgment and handoff?

It does not establish theft, financial loss, motive, a mistake, employee fault or a recovered saving. It does not claim that a modifier caused a void.

## Run and API

Use the existing Node 24 competition checkout. The pure calculation and tests do not need a model or sponsor service.

```powershell
node --test test/void-proof.test.mjs
```

`getVoidFixture(scenario)` asynchronously returns five explicit source families: `coverage`, `employees`, `original_orders`, `adjustments` and `workflow_events`. Each family and source row has a unique ID, fictional classification, location, source-period start and end, and currency.

`analyzeVoidProof(records, scope = VOID_SCOPE)` returns a JSON-safe result with `status`, `proof_status`, `period`, `summary`, `employee_metrics`, `void_actor_metrics`, `ranked_review_candidates`, `workflow`, `facts`, `evidence`, `missing_evidence`, `trace`, `limitations` and `integration`.

Invalid identity, scope, period, economic linkage or chronology throws the shared competition `EvidenceError` with a specific `VOID_*` code. No answer is silently repaired or substituted.

## Complete periods and denominators

The source month is September 1 through 30, 2026. The selected weekly period is Monday September 21 through Sunday September 27. The monthly scenario selects the complete September calendar month. These are fictional historical periods, not current operating results.

Coverage must explicitly declare complete original orders and complete adjustments, define the denominator as distinct original order IDs created in the selected period, and state expected source counts. Observed counts must match. This checks the consistency of the fictional source declaration. It does not independently audit whether an actual POS export omitted a record.

The original-order extract is separate from the adjustment extract. Void and refund rows are never counted as additional original orders. Employee rates are:

`distinct original orders in the employee's cashier cohort with a recorded void / all distinct original orders in that same complete cashier cohort`

Multiple partial void events on one order increase the event count, but that order appears only once in the voided-order numerator. Rates round to 0.01 percentage point using integer arithmetic. Cents are summed with BigInt and refused if the output exceeds the safe integer range.

Incomplete coverage holds `summary`, employee metrics, actor metrics and people rankings. It produces a request for the missing original extract, not a partial employee rate.

## Identity and economic linkage

The cashier comes from the original order source. A separate adjustment record identifies the void initiator and optional recorded approver. These roles are displayed separately. A manager who initiates a void is not silently made its original cashier. An absent approver remains unknown. A recorded approver is not independent proof of valid authorization.

Employee IDs must resolve to one explicit identity record with the appropriate source role. Names are not merged. Conflicting original-cashier identity, unknown initiators and ambiguous identity records are refused.

Each adjustment has a distinct economic reference. Duplicate economic IDs are refused even when one row says void and another says refund. Linked reversals and related adjustments require separate reconciliation rather than adding two positive changes. Total positive void and refund adjustments cannot exceed the original recorded order amount. Refunds remain separately reported and are excluded from void totals.

An adjustment recorded in the selected period against an earlier-period original order requires a separately defined cohort denominator and is refused by this bounded workflow. No cross-period employee rate is invented.

## Modifier chain and time bounds

The one chain has four source stages: modifier request, POS dispatch, kitchen acknowledgment and handoff. Each present stage must match the same chain, original order, modifier ID and source business date. Present parent IDs must point to the immediately preceding stage. Observed timestamps cannot run backward or precede the original order.

The source declares an exact UTC export instant, `2026-10-01T12:00:00Z`. Every original-order, adjustment and workflow observation must be at or before that instant. Impossible calendar timestamps and observations later than the export are refused. Business dates remain explicit source values. The code does not infer a restaurant's business-day cutoff from UTC dates.

A missing acknowledgment produces unknown continuity. A later recorded handoff does not fill in that acknowledgment. A parent referring to a present wrong stage is an invalid link, while a missing required parent source is a request for evidence. A missing record does not establish that a kitchen or employee failed.

The chain verifies source-ID and recorded-timestamp linkage only. It does not independently verify that the modifier text was delivered unchanged to a kitchen screen, that someone saw it, or that a physical handoff occurred. The requested modifier text is retained in the original request record. A stronger payload-delivery claim would require exact payload versions and delivery evidence at the other stages, which this build does not supply.

## Fictional scenario results

| Scenario | Supported result |
| --- | --- |
| `complete` | Six original orders, three distinct voided orders, four void events, USD 17.00 in recorded void amounts. One USD 3.00 refund is separate. All four modifier stages are source-linked. |
| `monthly` | Eight original orders, four distinct voided orders, five void events, USD 32.00 in recorded void amounts. Monthly denominators are calculated separately. |
| `incomplete-period` | One denominator order is absent and coverage is marked incomplete. Totals, rates and people rankings are held. |
| `missing-kitchen-link` | Complete-period count metrics remain supported. Kitchen acknowledgment is missing, so event continuity is unknown and the result requests its original source. |
| `wrong-location` | One adjustment has a different location. The workflow refuses it before arithmetic. |

In the complete week, Ava Demo's original cashier cohort has three orders, two voided orders, three partial/full void events and USD 15.00 in recorded void amounts. Its void-order rate is 66.67 percent. Charlie Demo's three-order cohort has one voided order, one event, USD 2.00 and 33.33 percent. Ben Demo is separately recorded as the initiator of the four void events, not as either original cashier. These people and records are fictional.

## Human review prompts

People candidates sort by recorded void cents, then void-order rate and stable employee ID. Each candidate supplies its exact source IDs and a request for human review. This ordering prioritizes source inspection. It is not a misconduct score or a claim that the highest amount is wrong.

The next human check is to inspect the original order, adjustment, initiator and recorded approval sources, or to obtain the missing event source. This workflow sends no message, assigns no task, changes no POS record and claims no completed action.

## Execution boundary

The module is deterministic and operates only on the supplied fictional JSON. It makes no network or model call. Existing labor sponsor proof does not establish sponsor execution for this new path. `model_verified` and `sponsor_integration_verified` remain false. A browser demonstration or passing local test does not establish customer acceptance or a production integration.
