# StellarTCG Set Catalog

Public metadata and curated packaging artwork for StellarTCG 1.54.0 and later.
No collecting content is installed by default. Pokemon TCG Pocket is excluded.

## Use in game

```
/tcg admin server refresh
/tcg admin server catalog ascended
/tcg admin server info ascended_heroes
/tcg admin server download ascended_heroes
/tcg admin server status
```

Arguments tab-complete. Staff need `stellartcg.admin` and `stellartcg.admin.content` (or operator access). An incomplete provider list requires the explicit `available` suffix. Existing sets, product IDs and administrator edits are never overwritten; this is a library for new installations, not an overwrite updater.

## Product artwork coverage

This pass catalogues **618 English product/artwork records** across Scarlet & Violet, modern Mega Evolution, 30th Celebration and 25th Celebrations. Each record has separately named front, back, left, right, top and bottom panels plus an inventory icon. Multi-tin sheets are split into individual covers.

**These are not 601 completely scanned retail packages.** Authentic photographs, perspective-corrected crops, supplied authentic panels and companion artwork are explicitly distinguished per face. Missing retail views use the previously approved companion artwork and remain listed for review. Do not describe companion panels as retail scans. The owner's Ascended Heroes ETB has all six supplied authentic panels and its supplied icon. The Celebrations UPC has photographed front, rear, left, right and top panels; its unseen bottom remains a companion panel.

See [the product artwork source catalog](sources/product-artwork-catalog.json), [processing recipes](sources/product-artwork.json), and generated `catalog/products/<set-id>.json` reports. Each published panel has source provenance and an output SHA-256. Photographic packaging uses WebP quality 95; supplied flat panels and included card scans remain lossless. Crops are not enlarged beyond their source pixel density.

**Ready product templates** are attached to the set manifests only after their contained cards, finishes, packs and pool entries can be resolved. Mixed-expansion packs and unverified special printings remain pending, rather than being silently substituted. Every catalogued product’s six-face artwork is downloaded with its set. Pending visual templates are saved in `catalog/reports/<set-id>.json`; they are not activated as empty or invalid products. Consult the per-set report for the actual installable count.

Included promo/Energy scans are supplementary printings excluded from numbered-set completion and ordinary pack pools. Unverified executable battle profiles remain disabled. Physical accessory rewards require server-specific cosmetics configured through the product editor; these are documented in template metadata. Gameplay pack collation/weights are configurable defaults, not a claim of factory pull odds.

## Accuracy and safety

* Card metadata comes from a pinned [TCGdex snapshot](https://github.com/tcgdex/cards-database); its MIT license is retained in `sources/TCGdex-LICENSE.txt`.
* Ordinary variants come from source records. Missing stamped/Master Ball or other special fronts remain reviews; another printing's art is not relabeled as that special printing.
* Battle mappings require exact implemented printing fingerprints. Importing readable attack text does not create new executable attack logic.
* Compressed manifests and artwork are checksum-checked and decoded before installation. The importer enforces disk, image and network limits and preserves custom edits.
* Successful artwork is moved into live content; no second permanent importer artwork cache is kept.
* The weekly/manual Actions workflow reuses unchanged published panels. A changed source checksum stops publication instead of silently replacing the artwork.

Pokemon artwork and trademarks belong to their respective rights holders. Original photographs and retail documentation remain credited by URL in the face records. Companion illustrations are clearly marked. This project is not affiliated with The Pokemon Company.

Upcoming Delta Reign artwork is catalogued as a preview, but its English card catalogue is not yet exposed by the metadata snapshot. It remains unavailable to the in-game installer until that source metadata exists.
