# Synthetic source inputs

Declared before the build window. These records are made-up competition inputs, not customer results, recovered cash or savings. They were split from `labor-variance.json` to make source boundaries explicit.

The four source families are sales, labor, operating policy and manager reports. Every record carries the restaurant, shift, business date and classification. The manager report remains unverified even when a reviewer chooses to retain it in memory. It must not overwrite the payroll record.

`source-manifest.json` records file hashes, source IDs and independent arithmetic checks. The expected bridge is $420 from the sales denominator and $180 from labor dollars, totaling a $600 gap. This bridge does not establish the cause of the sales change, whether training was approved, or any avoidable cost.

`sources/labor_missing_wages.json` deliberately omits both wage rates and payroll amounts. The application must ask for that source evidence. It cannot quietly reuse the complete fixture or assume the missing rate.

These files are not hosted endpoints or registered Zetaris sources. Before claiming federation, make them reachable from the sponsor runtime, register the source families there, query them through the real Zetaris service and retain its response and source identifiers. A direct local JSON read is only a development fixture path.
