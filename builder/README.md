# StellarTCG set catalog builder

The catalog contains metadata and source artwork URLs, never the artwork library itself. It uses a pinned TCGdex source snapshot and checks the provider's per-language artwork listings. Physical TCG sets are included; Pokemon TCG Pocket is excluded.

## Rebuild

Requires Node.js 22+, Python 3.10+ and the locked TypeScript dependency.

```
npm ci --ignore-scripts --no-audit --no-fund
python prepare.py --output .catalog-work
node build.mjs --source .catalog-work/tcgdex --profiles sources/battle-profiles.json.gz --output catalog --cache .catalog-work/http --overrides sources/overrides.json
```

The TypeScript AST reader accepts literal values, references, spreads and string concatenation. It does not execute upstream JavaScript. Parser failures, missing scans and special-printing reviews appear in coverage reports. Source metadata's MIT license does not grant ownership of Pokemon artwork; images remain on their source hosts.

## Accuracy

* Plain normal, holo and reverse variants are created only from explicit source records. Unclassified scans use `source_scan`, not an invented normal printing.
* Stamps, alternate foil patterns, jumbo and other special printings require a curated override with the correct image/finish. Missing ones remain in `reviews` and do not enter pack pools or master completion.
* Neutral variant weights of 1 are server defaults, not official pull rates.
* Battle mappings require exact printing identifiers and full attack/ability text, costs, damage, HP, stage, evolution and retreat signatures. Pinned profile records are reapplied only when the source signature still matches. New/changed cards remain collectible without battle access until implemented and verified.
* Product definitions are installed only from explicitly verified overrides. The absence of product records is reported; the builder does not fabricate retail contents, pull odds or packaging faces.

## Curated overrides

`sources/overrides.json` uses `cards["en/sv03.5/001"]` and `products["en/sv03.5"]`. A card entry can provide `front`, an explicitly reviewed `battle_engine`, and `variants`. Each variant supplies `definition` (StellarTCG variant JSON), its exact upstream `printing` object, an optional artwork `url`, and optional `sha256`. `definition.front` is relative to the generated card JSON. A product entry requires `status: "verified"`, a `definition` whose ID begins with the catalog set ID plus `/`, and optional `assets` with set-relative `path`, HTTPS `url` and optional `sha256`. All referenced cards/products must exist; the server validates dependencies before publication.

Example special-art mapping (replace placeholder URL with a verified source before publishing):

```json
{"cards":{"en/example/001":{"variants":{"master_ball":{"printing":{"type":"reverse","foil":"masterball"},"definition":{"name":"Master Ball","weight":1,"front":"001_master_ball.webp","effects":[{"id":"reverse_holo","area":"reverse"}]},"url":"https://your-approved-artwork-host.example/001_master_ball.webp"}}}},"products":{}}
```

Administrators must add custom artwork hosts to `server-catalog.json`. A finish is an in-mod approximation unless its exact pattern has been separately verified. Generic holo rendering is not a claim of physically identical foil.
