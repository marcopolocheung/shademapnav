# How much canopy does OSM actually have? — measured 2026-09-09

**Taken during A7**, because A7 is the only checkpoint that has this data in front of it,
and three decisions downstream turn on it: **#275** (should the renderer paint tree
shadow?), the confidence A7 reports, and the Wave 4 residual the roadmap wants measured
rather than assumed.

Reproduce with `node scripts/canopy-census.mjs --radius 800` (and `--radius 1500`). It
queries the public Overpass API from Node, read-only. OSM changes under this note; re-run
rather than trusting the numbers below indefinitely.

## What was measured

Three cities — the same centres the A3 agreement corpus uses, so the coverage number and
the agreement number describe the same places. Two radii around each centre, plus a
whole-municipality count compared against what that municipality publishes about its own
trees.

**This measures tag density, not ground truth.** Nothing here counts the trees on a street.
The municipal comparison is the closest thing to ground truth available without fieldwork,
and its caveats are stated with it.

## The headline

> **Madrid holds at most about one street tree in four. Singapore holds about one in a
> hundred.**

| Whole municipality | OSM `natural=tree` | Published inventory | OSM share |
|---|---:|---:|---:|
| Madrid | **68,713** | ~300,000 street trees ([Ayuntamiento de Madrid][madrid]) | **≤23%** |
| Singapore | **5,002** | ~500,000 urban trees ([Trees.SG][treessg]) | **~1.0%** |

Both shares are *upper* bounds on street-tree coverage, because OSM's count includes park
trees while Madrid's 300,000 is street trees alone (the city's parks hold on the order of
1.7 M more) and Singapore's 500,000 is roadside and park trees together. Kent, WA has no
published inventory to hand, so it is left uncompared rather than compared against a guess.

## Density and tagging, per corpus city

800 m radius (2.0 km²) around each corpus centre:

| | Madrid | Singapore | Kent, WA |
|---|---:|---:|---:|
| `natural=tree` | 2,500 | **0** | 600 |
| walkable street km | 115.2 | 20.2 | 118.9 |
| trees per street km | **21.7** | **0** | **5.0** |
| `natural=tree_row` | 0 | 0 | 4 |
| woodland ways | 0 | 0 | 10 |

1500 m radius (7.1 km²), with the tag breakdown over the trees found:

| | Madrid | Singapore | Kent, WA |
|---|---:|---:|---:|
| `natural=tree` | 7,656 | 273 | 1,000 |
| trees per street km | 17.9 | 2.2 | 3.8 |
| tree rows / row km | 111 / 11.2 | 10 / 1.3 | 18 / 3.0 |
| woodland ways / ha | 1 / 0.4 | 15 / 26.8 | 25 / 171.1 |
| `diameter_crown` tagged | **0.14%** | **0%** | **0%** |
| `height` tagged | **0.33%** | **0%** | **0%** |
| `leaf_type` tagged | 13.3% | 0.4% | 58.5% |
| `leaf_cycle` tagged | 1.8% | 0.4% | 55.8% |

## Five things this changes

**1. The crown model is its defaults.** `diameter_crown` and `height` are tagged on well
under 1% of trees in all three cities and on *none at all* in two of them. Every constant
in `canopy.ts` — crown diameter, tree height, the trunk fraction — is therefore not a
fallback but the model itself, applied to a bare point. They are documented as priors for
that reason, and the honest place the sparsity shows up is `CANOPY_MIX_FACTOR`, not a hedge
in the geometry.

**2. Seasonality mostly runs on an inference, and that inference is safe.** `leaf_cycle` is
tagged on 1.8% of Madrid's trees, so `inLeaf` almost always falls through to the
hemisphere window. Treating an untagged tree as deciduous reports *less* shadow out of
season, which is the direction that cannot route someone into sun while promising shadow.
Kent is the exception at 56% tagged — a reminder that coverage is uneven per city, not per
country.

**3. Singapore is the case that should worry a reader.** The A3 corpus centre has **zero**
tagged trees in 2 km² — no trees, no rows, no woodland, not even a park polygon — in a city
whose own agency maps half a million trees, and which is where the 0.5 preference weight A7
cites was measured (Melnikov et al. 2022). Canopy in Singapore is not sparse in OSM; it is
absent. Any claim that Umbra "routes around tree shadow" must not be made about a city
until this number is checked for it.

**4. #275 — painting canopy — has its answer, and it is "not on this data."** The question
was whether OSM has three trees on a forty-tree street or thirty-five. In Madrid it is
roughly ten; in Singapore, closer to half of one. Rendering 23% of Madrid's street trees
would make the map *visibly* wrong in a new way — a street painted with four crowns where
there are seventeen reads as a bug, whereas a street painted with none reads as "the map
does not draw trees." The field is the right place for a partial canopy, because a number
can carry a confidence and a paint stroke cannot. Recorded on #275; revisit against A8's
raster (Meta/WRI 1 m canopy height), which does not depend on anyone having tagged a point.

**5. The Wave 4 residual now has a floor to measure against.** The roadmap wants A7's
residual measured before deciding whether a photo corpus is worth it. Note in advance that
whatever A7 fails to close, **most of it will be missing tags rather than a wrong crown
model** — 1% coverage in Singapore cannot be fixed by a better transmittance figure. That
points at A8's raster before it points at fieldwork.

## What would change this note

A re-run: OSM tree data is one of the faster-growing tag families, and Singapore in
particular could change quickly if NParks' inventory were ever imported. A per-bbox
municipal comparison — the shares above are city-wide, and central Madrid is better mapped
than its outskirts, so the corpus bbox's true share is likely higher than 23%. And A8's
raster, which replaces the whole question of who tagged what.

[madrid]: https://www.madrid.es/portales/munimadrid/es/Inicio/El-Ayuntamiento/Medio-ambiente/Parques-y-jardines/Patrimonio-Verde/Arbolado-viario/Arbolado-viario
[treessg]: https://www.tech.gov.sg/technews/the-inside-story-of-how-nparks-mapped-500000-trees-in-singapore-on-treessg/
