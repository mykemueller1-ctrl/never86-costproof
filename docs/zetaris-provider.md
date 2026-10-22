# Call the checked Zetaris source provider

The provider is exported from `src/sources.mjs` without changing `readFixture()` or the legacy `requireZetaris()` hard stop. Root application code should call the new provider directly for live source mode.

```javascript
import { readZetaris, getZetarisStatus } from './sources.mjs';

const status = await getZetarisStatus();
const sources = await readZetaris(['sales', 'labor', 'policy']);
// sources.records, sources.trace, sources.provider, sources.zetaris_verified
```

`readZetaris(order, { client?, env?, scope? })` accepts each of the three families once. `scope` defaults to the declared synthetic demo scope. The optional client must be an actual checked `Zetaris` adapter with matching proof. Injected HTTP transports remain labeled as test transports and cannot set `zetaris_verified` true. Unknown options, including `scenario`, are rejected. Live sources never apply fixture mutations or fall back to local files.

The provider reads these values from the process environment:

```dotenv
ZETARIS_BASE_URL=http://127.0.0.1:8888/api/v1.0
ZETARIS_API_KEY=
ZETARIS_ORG_ID=
ZETARIS_MAPPING_PROOF_PATH=.costproof/zetaris-mapping-proof.json
```

It does not open `.env` or discover credential files. The existing server owns environment loading. `ZETARIS_BASE_URL` preserves this application's current name; the vendor documentation calls the equivalent direct API setting `ZETARIS_REST_URL`. An unset base uses the documented local default. The actual organization ID and user-created key are required.

Table names come from the reviewed proof. Optional `ZETARIS_TABLE_SALES`, `ZETARIS_TABLE_LABOR` and `ZETARIS_TABLE_POLICY` values must match it exactly. Proof paths can be native local JSON paths or paths relative to the project root. URLs, network shares, device paths, alternate streams, oversized files and unreviewed proofs are rejected. No proof was created by this work.

After actual source verification, the local proof must contain:

- `verified: true` and an `evidence_id` identifying the real saved verification receipt.
- `tables`: the three exact family-to-qualified-table names.
- `columns`: the three exact ordered arrays exported as `ZETARIS_COLUMNS` from `src/zetaris.mjs`, after comparison with real columns and returned rows.

Do not set that flag based on helper responses, a generated SQL plan or tests. It represents the actual schema and source comparison described in [the source helper](zetaris-fixture-http/README.md).

`getZetarisStatus({ client?, env? })` returns a safe configuration summary. It makes no network probe and always returns `verified: false` and `query_verified: false`. `configured_unverified` means local settings and a proof were accepted; a real run's trace establishes source-query verification. Other states are `not_configured`, `mapping_unverified` and `configuration_error`. The summary does not return credentials, proof paths or raw file/parser errors.

Six new contract checks use only injected HTTP responses and temporary test proof files. They verify environment hydration, proof rejection, safe status, no scenario mutation and no fallback. They do not establish a running Zetaris service, registered source, actual authorization or integration acceptance.
