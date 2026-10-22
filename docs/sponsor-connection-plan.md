# Sponsor connection plan

Sponsor requirements and connection plan. See the [README](../README.md) for current implementation and validation status. Setup and adapter tests do not establish a verified live connection.

## Meterless

The Participant Setup Guide dated October 21, pages 14 to 20, requires at least one working engine in the app plus Nightshift as a primary AI provider. The unmodified public H-MEM reference is declared prior work. Verify application memory scope, recall in a new process and audit history separately.

Use the current [official Power Prompt](https://www.meterless.ai/engines.html), provider contract v4 / Runtime 1.4. Before implementation, read it again for changes. Normalize the supplied base URL to exactly one `/v1`; use real Bearer authorization, an app identifier and user scope. Treat model IDs as routing modes obtained from discovery. A health response proves only a live process. Wrong-token discovery must show unauthorized, and valid discovery plus a real text response must pass. Allow the documented model-load timeout. Never log tokens or connect fragments. Keep credentials out of source and screenshots.

The intended flow is application -> Nightshift -> configured model -> application. H-MEM stores reviewed source-scoped corrections. The NVIDIA hardware award needs evidence of actual Nemotron use through Nightshift in a working feature; a route called auto cannot establish the underlying provider. Use an explicit verified lane where the installed version supports it.

Complete the official Nightshift installation and configure the local runtime through its settings. Record valid model discovery and an actual text response before claiming the model connection works. Keep account recovery, download troubleshooting and hardware details in private working records.

## Zetaris

Use the vendor's local runtime with its documented Docker requirements. Keep the downloaded runtime, vendor configuration and credentials outside this publishable repository. Verify startup and an actual scoped source query before claiming the data connection works. Machine setup and account details belong in private working records.

The setup guide page 11 specifies the local REST path under `http://localhost:8888/api/v1.0`, SQL execution at `/sql-editor/sqls/run`, Bearer authorization, `X-Org-ID` and a fresh `X-Request-ID`. Confirm the running version's schema and supported read-only query path before sending a request. The guide directs the participant to create the API key themselves. No key was created or copied into this repository.

Expose tiny synthetic sales, labor and policy sources through storage that the Zetaris container can actually reach. Local laptop paths do not automatically become accessible query sources. The app must ask Zetaris for the records and retain the actual query response, source IDs and scope checks. Reading a local JSON file in the application cannot pass as Zetaris federation.

## Cursor and entry proof

Use Cursor for meaningful development and capture dated evidence during the official build window. Keep development activity, model usage and runtime integration evidence distinct. Refer to the README for the current recorded work.

Final evidence needs a working source query, actual model trace, application H-MEM restart recall, critic retry/escalation, missing-record refusal, setup README, repository, deck and video. All prewindow documentation and reference setup must stay declared.
