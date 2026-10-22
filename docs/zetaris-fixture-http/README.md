# Synthetic HTTP source for Zetaris

This helper serves the existing `seed/sources/sales.json`, `labor.json` and `policy.json` envelopes unchanged at `/sales.json`, `/labor.json` and `/policy.json`. `/manifest.json` gives their SHA256 hashes. It accepts GET and HEAD only. It does not read credentials, execute SQL, register sources or change vendor Docker files.

From the repository root, use Node 24:

```powershell
node docs/zetaris-fixture-http/server.mjs
```

The default is `127.0.0.1:4318`. Tests use an ephemeral loopback port and close it afterward. No persistent service was started while preparing this helper.

Zetaris in Docker needs a URL reachable **from its query engine**. Docker Desktop documents `host.docker.internal` for host services. The loopback test does not prove that route works. Inspect the actual network before changing a bind address. `--host 0.0.0.0` is an explicit option, never the default; it exposes only these synthetic endpoints on the host's interfaces. No firewall changes are made. A source container on the existing Docker network is another possible deployment, but none was created or tested here.

Once the actual source origin is reachable, print a registration plan:

```powershell
node docs/zetaris-fixture-http/registration-plan.mjs http://host.docker.internal:4318
```

This prints ten unexecuted CREATE statements plus read-only verification. It never connects. `registration.template.sql` contains an intentionally unresolved origin. Inspect existing objects, choose unused names if needed, and execute one statement per call through the vendor runner or SQL Editor. Do not send the whole file as one SQL request. The client adapter rejects CREATE operations.

The plan follows the official REST table and `explode(records)` SchemaStore view pattern. This runtime's actual inferred schema, null behavior and SQL acceptance remain untested. All three complete fixtures are used for initial inference; missing wages are not silently replaced with zero. Querying these views through Zetaris must return the same IDs, columns, types, scope and values as the independent HTTP payloads before recording a mapping proof. A helper response, successful CREATE or passing stub test cannot establish that proof.

Prerequisites: running WSL/Docker and Zetaris, source reachability, actual organization ID, a user-created API key stored privately, fresh running API specification, source creation permission and verified unused object names. These are setup gates, not completed steps.

Sources: [official Zetaris REST example](https://github.com/zetaris/getting-started/blob/main/open_data/rest_apis/sql/non_rate_limited/02_pokeapi_create.sql), [JSON shape guidance](https://github.com/zetaris/getting-started/blob/main/docs/guides/zetaris-lightning-sql-companion.md), [Docker host networking](https://docs.docker.com/desktop/features/networking/networking-how-tos/).
