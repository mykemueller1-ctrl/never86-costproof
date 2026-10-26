# SKU prices to recipe ingredient cost

This extension was written on October 26, 2026 during the build window. It is a second investigation in CostProof, alongside the labor gap. It uses explicitly fictional records. It does not copy existing private Never86 application code or customer records. The operating ideas of preserving pack units, approved SKU matches, recipe versions and usable yields predate this event and are declared prior research.

Start the existing server, then open `http://127.0.0.1:4317/recipe`. The labor investigation remains at `/`.

## The owner decision

Before changing a menu price, inspect what changed in the plate. The complete fixture follows four ingredients from selected baseline and current purchase prices through approved SKU matches, usable yields and the recipe bill of materials. The stated tax-exclusive menu price supplies the comparison denominator.

The same fictional serving moves from **$1.96 to $2.40** in modeled ingredient cost: **44 cents more per serving**. At a stated **$10 menu price**, ingredient cost moves from **19.6% to 24.0%**. Menu price less ingredients moves from **$8.04 to $7.60**, before labor and overhead. These are calculated scenario values, not customer results, accounting profit or savings.

The pack-change case compares equivalent ingredient quantities. It does not treat a higher or lower case price as a unit-price change without checking the contents. Missing usable yield, a missing ingredient or missing purchase evidence holds the cost answer. A different restaurant or currency is refused. The calculation uses exact rational intermediates and records its cent-rounding policy.

## Sources and execution boundary

The four source families are purchase prices, approved ingredient-to-SKU mappings with explicit yields, a versioned recipe with portions, and a matching menu price. Source invoice and line identifiers and dates remain separate from the comparison scope. Open an ingredient or the full receipt to inspect its basis and records.

The price basis is the selected synthetic purchase record. The implemented scope excludes tax, freight, discounts and credits. It does not infer inventory valuation, actual consumption, sales mix or vendor substitutions. Mass and volume cannot be interchanged without ingredient-specific evidence.

This extension is a **deterministic local fixture preview**. It does not execute Zetaris or Nightshift, and it does not establish a new live sponsor integration. The labor workflow has its separately dated October 24 synthetic sponsor execution evidence. New recipe sponsor adapters, customer connections, inventory consumption and accepted human actions remain future work.

## Verification

The normal application test command includes recipe arithmetic and refusal cases plus the HTTP route contract. The existing labor tests and three replay contracts must continue to pass. The HTTP route accepts only the fixed scenario names and `sourceMode: fixture`; arbitrary file paths, user-supplied records and live-mode requests are refused. It uses the same loopback, host and same-origin JSON guards as the labor endpoint.
