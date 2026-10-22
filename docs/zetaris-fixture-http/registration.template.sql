-- UNEXECUTED PLAN. Verify source reachability and inspect existing objects first.
-- Based on the official Zetaris PokéAPI REST/SchemaStore recipe.
-- Run one statement per call. Do not replace existing objects blindly.

CREATE SCHEMASTORE CONTAINER costproof;

CREATE LIGHTNING DATABASE CP101_SALES DESCRIBE BY "CostProof synthetic sales";

CREATE LIGHTNING REST TABLE source_rows FROM CP101_SALES REQUEST (
  endpoint "__VERIFIED_SOURCE_ORIGIN__/sales.json",
  method "get",
  response_type "json",
  http_encoding "URLENCODED"
) HEADER () BODY ();

CREATE SCHEMASTORE VIEW sales WITH CONTAINER costproof AS
SELECT
  evidence_row.id AS id,
  evidence_row.classification AS classification,
  evidence_row.currency AS currency,
  evidence_row.restaurant_id AS restaurant_id,
  evidence_row.shift_id AS shift_id,
  evidence_row.business_date AS business_date,
  evidence_row.planned_net_sales_cents AS planned_net_sales_cents,
  evidence_row.actual_net_sales_cents AS actual_net_sales_cents
FROM cp101_sales.source_rows
LATERAL VIEW explode(records) AS evidence_row;

CREATE LIGHTNING DATABASE CP101_LABOR DESCRIBE BY "CostProof synthetic labor";

CREATE LIGHTNING REST TABLE source_rows FROM CP101_LABOR REQUEST (
  endpoint "__VERIFIED_SOURCE_ORIGIN__/labor.json",
  method "get",
  response_type "json",
  http_encoding "URLENCODED"
) HEADER () BODY ();

CREATE SCHEMASTORE VIEW labor WITH CONTAINER costproof AS
SELECT
  evidence_row.id AS id,
  evidence_row.classification AS classification,
  evidence_row.currency AS currency,
  evidence_row.restaurant_id AS restaurant_id,
  evidence_row.shift_id AS shift_id,
  evidence_row.business_date AS business_date,
  evidence_row.planned_hours AS planned_hours,
  evidence_row.actual_hours AS actual_hours,
  evidence_row.hourly_rate_cents AS hourly_rate_cents,
  evidence_row.planned_labor_cents AS planned_labor_cents,
  evidence_row.actual_labor_cents AS actual_labor_cents,
  evidence_row.wage_scope AS wage_scope
FROM cp101_labor.source_rows
LATERAL VIEW explode(records) AS evidence_row;

CREATE LIGHTNING DATABASE CP101_POLICY DESCRIBE BY "CostProof synthetic policy";

CREATE LIGHTNING REST TABLE source_rows FROM CP101_POLICY REQUEST (
  endpoint "__VERIFIED_SOURCE_ORIGIN__/policy.json",
  method "get",
  response_type "json",
  http_encoding "URLENCODED"
) HEADER () BODY ();

CREATE SCHEMASTORE VIEW policy WITH CONTAINER costproof AS
SELECT
  evidence_row.id AS id,
  evidence_row.classification AS classification,
  evidence_row.currency AS currency,
  evidence_row.restaurant_id AS restaurant_id,
  evidence_row.shift_id AS shift_id,
  evidence_row.business_date AS business_date,
  evidence_row.labor_target_basis_points AS labor_target_basis_points,
  evidence_row.target_scope AS target_scope
FROM cp101_policy.source_rows
LATERAL VIEW explode(records) AS evidence_row;

-- Read-only verification. Compare with the independent JSON sources.

DESCRIBE DATASOURCE TABLE costproof.sales;

SELECT id, classification, currency, restaurant_id, shift_id, business_date, planned_net_sales_cents, actual_net_sales_cents FROM costproof.sales LIMIT 2;

SELECT COUNT(*) FROM costproof.sales;

DESCRIBE DATASOURCE TABLE costproof.labor;

SELECT id, classification, currency, restaurant_id, shift_id, business_date, planned_hours, actual_hours, hourly_rate_cents, planned_labor_cents, actual_labor_cents, wage_scope FROM costproof.labor LIMIT 2;

SELECT COUNT(*) FROM costproof.labor;

DESCRIBE DATASOURCE TABLE costproof.policy;

SELECT id, classification, currency, restaurant_id, shift_id, business_date, labor_target_basis_points, target_scope FROM costproof.policy LIMIT 2;

SELECT COUNT(*) FROM costproof.policy;
