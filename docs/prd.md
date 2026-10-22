# Never86 CostProof specification

Prepared before the competition window. This document is declared prior work, not scored implementation.

## Problem and user

An owner or manager closes a shift with labor above target. Sales, scheduled labor, actual labor and the shift note sit in separate records. The owner needs the exact dollar gap and a justified next check without an invented cause or savings promise.

## Goals

1. Answer the fixture's shift question with an exact $600 gap, 33 percent actual labor and 28 percent target.
2. Reconcile the $600 bridge as $420 from the sales denominator change and $180 from the labor dollar change. This is an accounting bridge, not causal attribution.
3. Cite every numeric conclusion to source rows and calculation inputs.
4. Retain a reviewed manager correction across a fresh process using real Meterless H-MEM.
5. Complete the core demo in 1 to 4 minutes, showing real Zetaris queries and memory readback.
6. Run source planning, investigation and critique through a real model using Meterless Nightshift as the primary provider. Prove authorization, model discovery and a text response before calling the application integrated.

## User stories

- As an owner, I want the dollar variance before a chart so I can judge the size of the issue.
- As a manager, I want to inspect the exact rows behind the conclusion so I can correct a bad input.
- As an owner, I want the agent to say which record is missing so a guess does not become a staffing decision.
- As a manager, I want a correction to stay scoped to the relevant restaurant and shift so it does not silently change another location's answer.

## Scope

P0: one labor question; sales, labor and policy sources; source coverage; deterministic integer cent calculations; Zetaris source queries; real Nightshift model calls for source planning and critique; H-MEM reviewed correction storage and restart recall; one unsent manager action draft; replayable evidence trace; desktop and mobile readable result.

P1: a verified NVIDIA Nemotron model through Nightshift for the hardware award; two locations to prove scope; a compact comparison of the original and corrected investigation. The actual underlying model must be evidenced; an automatic route alone does not prove Nemotron use.

Future: live POS/payroll connections, notifications, paid offers, production multiuser deployment, broad invoice OCR and a complete owner desk. They are outside this competition entry.

## Required behavior and acceptance criteria

| Requirement | Acceptance criterion |
|---|---|
| Dollar math | Given sales $12,000 and labor $3,960 with a 28 percent target, the result is 33 percent, +5 percentage points and +$600 |
| Bridge | Given planned sales $13,500 and planned labor $3,780, the bridge is +$420 denominator effect and +$180 labor dollar effect; the sum equals +$600 |
| Coverage | Different dates, restaurants or currency cannot be silently joined; output lists every included and missing source |
| Wage absence | Hours without wages cannot produce payroll dollars; the exact missing wage/payroll record is requested |
| Zero sales | A zero denominator produces an explicit unavailable percentage, not Infinity or a forced zero |
| Evidence | Every source has an identifier, period, restaurant, source date, record type and synthetic label |
| Correction | A manager statement about training remains a manager report until separately verified; it does not alter source payroll or prove savings |
| Scope | Store B records and corrections cannot change Store A's result |
| Persistence | A new process recalls the reviewed correction and its provenance, while preserving the earlier analysis |
| Missing sponsor | Unavailable Zetaris or memory causes an explicit integration error; fixture fallback must be labeled and cannot pass the integration gate |
| Primary model provider | A real Nightshift models response and text request pass with the configured token; a wrong token is unauthorized, not offline; health alone cannot pass |
| Critique and retry | A critic rejects an explanation without source support; the investigator requests the missing evidence or revises its conclusion within a bounded retry budget; the trace shows this interaction |
| Action | The output proposes an owner and check; it does not send messages, change schedules or claim action acceptance |

## Agent workflow

Question -> scoped source plan -> read only Zetaris queries -> coverage validation -> deterministic math -> evidence linked explanation -> critic review -> bounded evidence retry or escalation -> one proposed check -> reviewed correction -> H-MEM record -> fresh process query with recalled context.

Use two explicit application roles, investigator and evidence critic, with visible messages and tool decisions. They may share a model/runtime; do not imply two independent models. A changed question or missing evidence must change the plan. Keep money arithmetic and record scope outside the model. A deterministic debug mode is useful locally but cannot satisfy the working agent and primary provider requirements. Do not represent a scripted walkthrough as autonomous reasoning. This is a proposed application architecture, not delegation to additional coding agents.

## Demonstration

0:00 to 0:20: owner question and $600 result.
0:20 to 1:10: open sales and labor sources, show the $420 plus $180 bridge and a real Zetaris trace.
1:10 to 1:50: add the manager's training correction with its provenance, show that the agent revises the next check without overwriting payroll.
1:50 to 2:40: restart, recall the correction from H-MEM, and inspect its audit history.
2:40 to 3:15: remove wages; show that the agent asks for the missing record instead of inventing dollars.
3:15 to 3:40: show sponsor wiring, use of Cursor and exactly what was built during the window.

## Gates and timeline

Before October 21, 7 p.m. Central: account, team, official resources, sponsor access, fixture, specification and declared library setup.
October 21 evening to October 22: working Zetaris query over the separate synthetic sources, Nightshift provider authorization/discovery/text checks and H-MEM recall; capture Cursor development evidence.
October 23: exact math, source coverage, scoped corrections and UI.
October 24: restart/error/scoping checks and a complete demo path.
October 25: record the video and produce the deck and source README.
October 26: first complete submission, if all requirements and terms are resolved.
October 27 before 6:45 p.m. Central: final corrections and readback.

These are internal targets, not a delivery promise. Myke directly selected full-time availability (40+ hours per week). The team is formed with one member and a saved first draft; the published rules say first submission creation locks membership. No numerical win probability is asserted.
