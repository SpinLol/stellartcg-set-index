# StellarTCG Set Catalog

Public set metadata for StellarTCG 1.54.0 and later. Catalogs contain JSON definitions, source artwork links and explicit coverage reports. The artwork library is not hosted in this repository.

The initial scan covers **380 physical set definitions**, exposed as **1,118 language-specific catalogs**, including **201 English set catalogs**. Coverage changes as upstream metadata/artwork becomes available; `catalog/coverage.json` is authoritative. Pokemon TCG Pocket is excluded.

## Use in game

Open **Admin > Content catalog > Online set library**, or run:

```
/tcg admin server refresh
/tcg admin server catalog paldean
/tcg admin server info paldean_fates
/tcg admin server download paldean_fates
/tcg admin server status
```

Set arguments tab-complete canonical IDs and unambiguous English names. Non-operator staff require `stellartcg.admin` and `stellartcg.admin.content`. The mod ships without collecting content: no set is installed until an administrator explicitly requests it.

Incomplete sets require the explicit `available` argument. Existing server sets and custom edits are never overwritten. Downloads are resumable, validated before publication and subject to configurable disk/network budgets. Successful artwork moves directly into live content; no second permanent importer artwork cache is retained. The existing StellarEngine/chest menus remain compatible.

## Accuracy

* Attacks and abilities import as text. Only exact, implemented printing profiles enable battles; name-only fallback is blocked for unverified imported cards.
* Plain variants come from explicit source records. Special stamps, Master Ball and other alternate fronts require verified mappings/assets. Unclassified scans are labeled `source_scan`; missing printings remain in per-set review reports.
* Product contents, packaging faces and retail pull rates are not invented. **The initial catalog has no verified sealed-product entries**; the schema and importer support adding them through curated overrides.
* Neutral variant weights are server defaults, not official pull odds. Generic rendered foil is not a claim of physically identical foil patterns.

Each compressed catalog is checked against the SHA-256 and byte lengths in `catalog/index.json`. HTTPS protects transport; this is not an independently signed catalog. Administrators can use a different trusted HTTPS index through `server-catalog.json`.

## Maintenance

The **Refresh set catalogs** Actions workflow runs weekly and can be dispatched manually. It parses a pinned TCGdex snapshot as literal data, checks artwork listings, verifies every generated manifest and commits changed metadata. Refreshing this repository never overwrites sets already installed on a server.

See [builder documentation](builder/README.md) for local builds and `sources/overrides.json` for curated special printings/products. Pinned executable-profile fingerprints prevent new or changed card text from inheriting unrelated battle logic.

[TCGdex](https://github.com/tcgdex/cards-database) supplies the multilingual metadata; its MIT license is preserved in `sources/TCGdex-LICENSE.txt`. Pokemon artwork and trademarks remain with their respective rights holders. This project is not affiliated with The Pokemon Company.
