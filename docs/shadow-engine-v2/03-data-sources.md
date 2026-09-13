# 03 — Data sources, licences, datums and regional bounds

Research and observations: **2026-09-12**. Settled inputs: [BRIEF](./BRIEF.md),
[00](./00-findings.md), [01](./01-current-engine-audit.md),
[02](./02-architecture.md), [02a](./02a-feasibility.md),
[02b](./02b-placement.md), [02c](./02c-lattice.md), and
[02d](./02d-delivery.md). The lattice is **z18**, with 256-cell tiles;
placement and receiver validity remain as specified in 02b and 02c.
This deliverable changes neither application code nor those decisions.

**The three architectural answers:**

1. **No reviewed provider supplies a complete, certified regional hierarchy for
   Umbra's normalized terrain, building tops and canopy tops.** GMTED2010 supplies
   actual minimum/maximum aggregation products, but only over its historical inputs.
   They do not bound the newer, differently normalized field. Build the hierarchy
   during regional normalization; areas outside that build remain unknown (§5).
2. **A global EGM96 assumption for AWS Terrain Tiles is unsafe.** This run confirms
   Madrid's EU-DEM and Kent's NED 1/3 arc-second source headers. Their published
   source datums differ. The endpoint does not document enough vertical processing
   to certify its delivered values as EGM96. Public licensed transforms exist for
   several explicit source CRSs, including a nominal EVRF2000 path in Spain, but
   that does not identify the transformation already applied by AWS (§4).
3. **Usable delivery pyramids exist, but they are not conservative caster pyramids.**
   AWS serves z0–15; Copernicus COGs have explicit reduced levels; GMTED has
   7.5/15/30 arc-second products. Coarse means can erase ridges. Distant terrain
   needs bounds of the selected fine field and refinement where those bounds are
   inconclusive. No source promises a new vertical accuracy at every overview (§6).

**Licence decision for implementation:** MIT applies to Umbra's code, not to its
input or normalized databases. OSM and Overture introduce **ODbL** obligations;
CHMv2 introduces **CC BY 4.0**; EU-DEM/Copernicus have Copernicus notices; Spain's
EGM08-REDNAP grid introduces **CC BY 4.0**. These are known inputs to the design,
not obligations to discover after shipping. Direct Microsoft data currently offers
CDLA Permissive 2.0, which provides a route without building-data share-alike;
using the Overture copy does not acquire that exemption. Details in §7.

`[OBSERVED]` means retained HTTP/file evidence; `[PUBLISHED]` means a publisher's
claim, not an Umbra validation; `[DERIVED]` means reproducible arithmetic;
`[DESIGN]` means an implementation requirement; `[UNKNOWN]` means the stated
information could not be established; `[UNMEASURED]` means no performance experiment
was conducted. RMSE, MAE and LE90 are statistical accuracy measures, **not hard
upper error bounds**. Native sample spacing is not positional or vertical accuracy.
The [evidence index](./evidence/03/README.md) gives methods, captures and limitations.

## 1. Dataset inventory and shared operating rules

The engine needs ground elevation `G`, building footprints and relative heights,
canopy height/validity, and vertical transformation grids. Crown underside and
seasonal transmission are the existing explicit priors, not newly discovered data.
Source masks, quality layers, dates, licences and spatial indexes are dependencies
of these datasets. Existing routing/receiver geometry is not replaced here.

The following codes make the catalogue compact; they are part of **every row**
that cites them:

| Code | Cost, limits or missing/error behaviour |
|---|---|
| A | Public anonymous object download costs the reader $0 in the documented open-data channel. Normalization, storage, serving and compute-provider egress are Umbra costs. No dataset-specific numeric request quota or availability SLA was published in the reviewed documentation; this does **not** mean unlimited throughput. Use bounded concurrency, cache immutable objects, honour throttling and retry transient failures with backoff. |
| P | Public download, $0 data fee; portal/account requirements differ from anonymous object access. No guaranteed requests/second or SLA found. Bulk download is preferable to an interactive public API for regional preprocessing. |
| T | Missing asset, failed request, corrupt decode, nodata or unresolved datum leaves terrain unknown. Use an independently admitted fallback only with a new declared recipe/provenance; never zero-fill land or treat a 404 as sea level. Unknown receiver terrain cannot establish the ray origin. |
| B | Failed/incomplete vector extraction means unknown building coverage. A successfully read, complete selection with no features means empty **in that source snapshot**, not proof that no real building exists. Missing height uses only the existing declared height/default policy, with inferred/default provenance; it is not a measurement or world-height bound. |
| C | Missing canopy file or invalid mask means unknown canopy. Valid height zero means no canopy in that source observation. Positive valid height is AGL. Use OSM fallback only where the raster is unavailable/nodata, per 02 §4.2; never replace valid zeros automatically. A failed source cannot be interpreted as transparent. |
| V | Missing grid, unknown CRS/realization, out-of-area transform or failed operation blocks the affected absolute elevation. Do not use a ballpark/zero-offset transform. Relative AGL data may remain cached, but cannot produce valid absolute `B`/`C1` without ground. |

[DESIGN] For all channels, distinguish permanent absence from 401/403 permission
errors, 429 throttling, transient 5xx/timeouts, truncated responses, and invalid
content returned with HTTP 200. Retain a previous complete immutable generation
with its age, or report incomplete evidence. Do not publish a partially overwritten
generation. Coverage and licence failures affect both consumers through the shared
field, not only the renderer. No outage was deliberately induced in this research.

## 2. Terrain catalogue

### 2.1 Primary sources and realistic alternatives

| ID / dataset and coverage | Native resolution; published vertical datum and accuracy | Licence and attribution | Cost / rate limits | Update cadence | Missing/error and admission |
|---|---|---|---|---|---|
| **T1 AWS Terrain Tiles / Mapzen mosaic** — global tiles within Web Mercator; source quality varies by geography and zoom | z0–15 delivery, 256px Terrarium. Native inputs range from metre-scale regional DEMs to 1 arc-minute ETOPO1; **z15 is not a 5m survey**. Terrarium quantum 1/256m. No single published vertical datum or accuracy for the delivered mosaic established; §4 and §6. | Mixed upstream terms, **not MIT/public domain as a whole**. Regional credits below; Tilezen/joerd's MIT code licence does not license the elevations. | A; no key. | Documented releases 2016/2017; no regular update commitment. Object modification date is not survey date. | T. Suitable retained probe source; **not admitted as a globally datum-certified production `G`**. [Registry](https://registry.opendata.aws/terrain-tiles/), [source guide](https://github.com/tilezen/joerd/blob/0b86765156d0612d837548c2cf70376c43b3405c/docs/data-sources.md). |
| **T2 Direct USGS 3DEP/NED DEMs** — US; 1/3 and 1 arc-second broad CONUS coverage, finer products partial; Alaska has distinct products | 1/3″ ≈10m, 1″ ≈30m, discontinued partial 1/9″ ≈3m, project 1m and Alaska 5m products. Usually NAVD88 in CONUS, but NGVD29/local mean sea level in some other areas; source metadata controls. Published 2022 CONUS 1/3″ RMSE **0.82m**; not a guarantee for legacy AWS Kent. Fine-project accuracy must come from its survey report. | Public domain; USGS requests credit, retain dataset/project citation and modification history. | P; public cloud copies may support A. Do not assume an authenticated portal's limits apply to its public objects. | Ongoing project replacement; no uniform annual resurvey. | T. Preferred ground source in covered US regions after datum/quality validation. [Datums/products](https://www.usgs.gov/faqs/what-projection-horizontal-datum-vertical-datum-and-resolution-a-usgs-digital-elevation-model), [accuracy](https://www.usgs.gov/faqs/what-vertical-accuracy-3d-elevation-program-3dep-dems). |
| **T3 EU-DEM, legacy source used by AWS Madrid** — most Europe | Geographic 1″ source, distributed also on a 25m European grid; AWS guide calls it 30m. Hybrid SRTM/ASTER surface model. Validation report specifies **EVRS2000 with EGG08**, ETRS89/GRS80. Accepted specification ±7m RMSE; 2014 validation overall **2.90m RMSE**, 991,179 points; Spain **1.89m**, 101,529 points. Exact AWS asset release/processing lineage remains unknown. | Copernicus reuse with EU-funded EU-DEM attribution; identify modifications. Not MIT. | Legacy AWS A; original CLMS distribution retired, so no current original-download quota to promise. | Historical product; retirement/replacement by Copernicus DEM is not a fresh EU-DEM survey. | T; §4's datum gate applies. [Validation report](https://ec.europa.eu/eurostat/documents/7116161/7172326/Report-EU-DEM-statistical-validation-August2014.pdf), [retired products](https://land.copernicus.eu/en/products/products-that-are-no-longer-disseminated-on-the-clms-website). |
| **T4 SRTM GL1 / SRTM3** — land about 60°N–56°S | 1″ ≈30m and 3″ ≈90m editions; EGM96 orthometric. Radar reflective surface, vegetation/building bias possible. Mission requirement **16m absolute vertical error at 90%**, with performance varying by land cover; no hard maximum error or per-AWS-tile accuracy. The [NASA/JPL guide](https://lpdaac.usgs.gov/documents/1318/NASADEM_User_Guide_V12.pdf) records this requirement; USGS demonstrates canopy bias. Do not promote an encoding increment to accuracy. | Public USGS/NASA/NGA distribution; preserve provider credit and supplied notices, including the historical foreign-copyright notice identified by Tilezen. No ODbL share-alike. | P directly; A through AWS. | February 2000 acquisition; subsequent void filling/reprocessing does not update buildings or trees to today. | T. Broad fallback elevation **proxy**, not surveyed bare earth in cities/forests. [Product](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-shuttle-radar-topography-mission-srtm-1), [USGS assessment](https://www.usgs.gov/special-topics/significant-topographic-changes-in-the-united-states/science/accuracy-assessment). |
| **T5 GMTED2010** — global, latitude/product coverage varies | 7.5″ ≈232m, 15″ ≈464m, 30″ ≈928m north–south. Seven aggregation products, including min/max. **Mostly EGM96, with documented source-datum exceptions** (§4). Published aggregate RMSE ranges respectively **26–30m, 29–32m, 25–42m**; no per-cell hard error certificate. | Public domain; credit USGS and describe modifications as required in the supplied use constraints. | P direct / A through AWS mean tiles. | 2010 static compilation, not a continuously refreshed hierarchy. | T. Min/max useful only for their declared input support; not Umbra's missing bounds index. [Product](https://www.usgs.gov/coastal-changes-and-impacts/gmted2010), [technical report](https://pubs.usgs.gov/of/2011/1073/pdf/of2011-1073.pdf). |
| **T6 Copernicus DEM GLO-30 / GLO-90** — global land products; AWS GLO-30 release documents restricted/missing tiles, GLO-90 broader; oceans omitted | 1″ and 3″ latitude spacing with wider longitude spacing at high latitudes; EGM2008. **DSM includes buildings/vegetation/infrastructure.** Published absolute vertical LE90 <4m; relative <2m on slopes ≤20%, <4m steeper; horizontal CE90 <6m. These are product statistics/specifications, not hard bounds or separate overview accuracies. | Free GLO-30/GLO-90 **Copernicus DEM licence**; prescribed source and modified-product notices, including DLR/Airbus/EU/ESA credits. Not generic CC BY or public domain. | A AWS; free registered CDSE access under product terms. EEA-10 is restricted to eligible users, not the general public free tier. | Mainly 2011–2015 acquisition with older infill; releases/maintenance, no annual resurvey promise. AWS COG readme describes a 2021 release. | T. Missing land asset remains unknown; do not apply the documented ocean convention to every 404. Good broad elevation fallback, but DSM is not automatically valid bare-earth `G`. [Product/terms](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM), [AWS distribution](https://registry.opendata.aws/copernicus-dem/). |
| **T7 England Environment Agency composite DTM** — about 99% of England for documented 2022 composite | 1m DTM, 5km tiles; Ordnance Datum Newlyn, OSTN15 horizontal transformation. Input surveys stated ±15cm RMSE vertically; composite resampling and mixed dates remain relevant. Old AWS component is 2m and cannot inherit this product's statistics. | Open Government Licence v3; retain Environment Agency copyright/database-right attribution and year. | P; no fixed public throughput guarantee found. | Catalogue says annual updates; 2022 composite surveys span 2000-06-06 to 2022-04-02. Metadata edits in 2025 are not new acquisitions. | T; use matching ODN vertical conversion, not OSTN15 alone. [EA catalogue](https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-digital-terrain-model-dtm-1m). |
| **T8 ArcticDEM / REMA public releases** — Arctic land including Alaska and Antarctica; parts outside Mercator operating range | Current native 2m DSM; reduced mosaic products in §6. WGS84 **ellipsoidal** heights. PGC gives approximate uncontrolled 4m horizontal/vertical guidance but explicitly says absolute strip/mosaic accuracy specifications have **not been verified**. Do not advertise 50cm without local control. | Current public ArcticDEM/REMA CC BY 4.0; preserve PGC/project/funding/imagery credits. Raw commercial imagery is not covered. | A/P. **Alaska acquisitions June 2022 onward have EOCL public-access restrictions**; EarthDEM is not a generally free global 2m extension. | Strip and mosaic releases differ; public mosaic ArcticDEM v4.1 July 2023, REMA v2 October 2022 in reviewed guide. | T; apply quality masks, reject artifacts, convert ellipsoidal heights. [PGC guide](https://www.pgc.umn.edu/guides/stereo-derived-elevation-models/pgc-dem-products-arcticdem-rema-and-earthdem/). |
| **T9 FABDEM v1.2** — global modeled ground alternative | ≈30m, removes forests/buildings algorithmically from Copernicus GLO-30; inherits its elevation reference subject to release metadata. No per-cell hard error bound. A specific local validation/accuracy is still required before calling it ground truth. | **CC BY-NC-SA 4.0**; commercial use requires separate arrangement. Attribution, noncommercial and share-alike obligations make it unsuitable as the unrestricted default data layer for public MIT Umbra. | $0 noncommercial download; commercial quote/terms not public. Public portal throughput not guaranteed. | Versioned research release, no regular refresh commitment. | T; **excluded from the default commercial-reusable stack**. [Publisher catalogue](https://research-information.bris.ac.uk/en/datasets/fabdem-v1-2/). |

**Additional identified national source:**

| ID / coverage | Native resolution; datum and stated accuracy | Licence / attribution | Cost / limits | Cadence | Missing/error |
|---|---|---|---|---|---|
| **T10 Direct LINZ New Zealand LiDAR DEM/DSM** — project coverage; publisher describes LiDAR DEM availability for about 90% of mainland | 1m grids, NZTM2000 horizontally, **NZVD2016 vertically** even though the TIFF itself omits a vertical key. Storage specification describes source LiDAR accuracy approximately 20cm without a universal confidence statistic; project report controls. LERC encoding error ≤1mm native, ≤10cm overviews is **compression error**, not survey/aggregation error. | CC BY 4.0; licensors vary by survey and are in STAC Collections. Attribute the actual licensor, LINZ access/source and modifications. | A, anonymous `nz-elevation` S3; no numeric dataset quota/SLA found. | Surveys added as published; sampled merged collection spans 2008–2025. No uniform resurvey interval. | T/V. DEM is ground; DSM needs class separation for canopy. [Registry](https://registry.opendata.aws/nz-elevation/), [TIFF contract](https://github.com/linz/elevation/blob/master/docs/tiff-specification.md), [coverage/product guide](https://github.com/linz/elevation). |

### 2.2 Remaining components hidden behind the same AWS URL

These are **not silently admitted fallbacks**. They explain why a single adapter
cannot declare the AWS endpoint public-domain/EGM96. Coverage and spacing below
are the archived producer's inventory; exact legacy-asset datum/accuracy gaps
cannot be filled by assuming that today's national product is the same asset.
Every row has cost/limits **A**, cadence **legacy mosaic, no guaranteed refresh**,
failure **T**, and unknown production vertical conversion until the original asset
metadata and its processing lineage are identified. Sources:
[pinned producer inventory](https://github.com/tilezen/joerd/blob/0b86765156d0612d837548c2cf70376c43b3405c/docs/data-sources.md)
and [licence inventory](https://github.com/tilezen/joerd/blob/0b86765156d0612d837548c2cf70376c43b3405c/docs/attribution.md).

| Component / coverage / native spacing | Published datum/accuracy available for the **legacy input** | Licence and attribution obligation |
|---|---|---|
| ETOPO1 — global relief/bathymetry, 1 arc-minute | Mean-sea-level reference; heterogeneous source accuracy, no hard regional accuracy certificate in endpoint metadata. Not demonstrated equivalent to EGM96. | US government material; NOAA/NCEI credit and supplied notices. Published warning against navigational use; do not use this coarse bathymetry as a walking-surface source. |
| CDEM — Canada, 20–400m in producer inventory; native base 0.75″ north–south and 0.75–3″ east–west | The [2013 edition 1.1 specification](https://ftp.maps.canada.ca/pub/nrcan_rncan/elevation/cdem_mnec/doc/CDEM_product_specs.pdf) publishes **CGVD28 orthometric**, NAD83(CSRS); ground/reflective surface and positional accuracy are in source metadata. Nova Scotia shoreline has a documented mean-high-water exception. Original AWS extraction resolution/vertical processing still needs identification; licensed Canadian grids exist (V8). | Open Government Licence – Canada; retain its prescribed acknowledgement. |
| Environment Agency — England coverage, 2m legacy component (guide loosely says UK) | Old source's survey date/datum chain and accuracy not supplied by the endpoint. T7's 1m/2022 ODN specification is not retroactive evidence. | OGL v3; Environment Agency copyright/database-right notice for the source release. |
| Austria DGM — Austria, 10m | Legacy source datum/accuracy not established by producer inventory. Current national catalogue also omits a numerical vertical-accuracy guarantee. | Producer records CC BY 3.0 AT; current [national catalogue](https://www.data.gv.at/katalog/de/dataset/dgm) says CC BY 4.0. Pin the licence of the actual ingested release; credit geoland.at/providing states. |
| Geoscience Australia — coastal parts of South Australia, Victoria and Northern Territory, 5m | Exact legacy source vertical datum and survey-specific error not stated by the AWS inventory; do not substitute a continent-wide geoid assumption. | CC BY 4.0; Commonwealth of Australia/Geoscience Australia 2017 credit recorded by producer. |
| INEGI continental relief — Mexico, spacing not specified in producer inventory | Exact product/version, vertical datum and accuracy unresolved from endpoint documentation. | INEGI free-use terms with source acknowledgement; producer specifies continental relief 2016. |
| Kartverket DTM — Norway, 10m | Exact legacy vertical realization and accuracy unresolved; do not equate historical NN1954/NN2000 transitions with an EGM96 declaration. | CC BY 4.0; Kartverket attribution. |
| LINZ DEM 2012 — New Zealand, 8m | Exact legacy vertical realization/accuracy not established here; present-day NZVD2016 metadata does not establish the 2012 asset's datum. | Producer records CC BY 3.0 NZ; retain LINZ/New Zealand Crown notice. |
| ArcticDEM legacy — above 60°N and Alaska etc., 5m in producer inventory | Current direct PGC products are ellipsoidal, but exact legacy AWS conversion/accuracy remains undocumented. | Producer's unrestricted-use statement includes mandatory project/funding/imagery credit; current direct release is CC BY 4.0 (T8). |
| NED topobathymetry / Great Lakes ancillary inputs — limited US water/coastal areas, asset-dependent spacing | Not a universal land elevation source. Producer code contains local vertical handling, but no endpoint-wide vertical contract or accuracy. Exclude from walking-ground admission without asset metadata. | US government/provider notices; preserve identified source attribution. |

## 3. Buildings, canopy and auxiliary data

### 3.1 Buildings

| ID / coverage | Native geometry/resolution; datum and stated accuracy | Licence / attribution | Cost / limits | Cadence | Missing/error and use |
|---|---|---|---|---|---|
| **B1 OpenStreetMap buildings and building parts** — global, uneven completeness | Vector polygons/multipolygons, no universal spatial resolution or height accuracy. Heights/levels are relative attributes; no absolute vertical datum. Preserve holes/parts and full-feature foundation. 02d's Madrid extract had 5,658 closed ways, **4,552 default heights**: not a measured-height census or complete relation extraction. | **ODbL 1.0**; OpenStreetMap contributors credit, licence link and derivative-database obligations (§7). | Data $0. Public Overpass main-instance guidance: about **10,000 requests/day and <1GB/day**, adaptive slots/cooldowns; neither reserved capacity nor an SLA. | OSM continually edited; extract/replication lag depends on distributor. Pin snapshot timestamp. | B; parse Overpass error/remark even with HTTP 200; 429 and capacity-related 504 are documented. Regional extracts/batch queries, not one live query per user. [Copyright](https://www.openstreetmap.org/copyright), [Overpass operating limits](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html). |
| **B2 Overture buildings + building_part** — global conflation, source coverage varies | Vector GeoParquet. Optional height is relative; no universal height RMSE or complete-height guarantee. Schema height means lowest-to-highest distance; `min_height` is a separate ground clearance: normalize semantics explicitly. Publisher filters heights ≥900m, which is not a real-world maximum or an absolute-top bound. | **ODbL theme**, plus relevant upstream credits. OSM has highest conflation priority; filtering a `sources` label is not proof that ODbL-derived attributes have been removed. | A through public S3/Azure. No numeric per-client quota/SLA found; bbox/column pruning can reduce bytes, but no ready absolute-top index. | Monthly releases; snapshot date is not imagery/survey date. | B. More complete ingestion path than a ways-only Overpass probe, but adds known ODbL publication work. [Guide](https://docs.overturemaps.org/guides/buildings/), [schema](https://docs.overturemaps.org/schema/reference/buildings/building/), [attribution](https://docs.overturemaps.org/attribution/). |
| **B3 Direct Microsoft GlobalMLBuildingFootprints** — global partitioned coverage, holes from imagery selection | Vector polygons. Some imagery-derived heights are **mean AGL within polygon**, not measured roof maxima; `-1` means no estimate. Footprint confidence is not height confidence. No global numerical height-error guarantee published in reviewed README. | **CDLA Permissive 2.0** in current direct repository, pinned commit `c691ea1a09dfe9bd91b8e1db7ee31e7b6b3c7fbe`. Include agreement text when sharing data. Credit Microsoft/provenance; no ODbL share-alike on this direct release. | A-equivalent public Azure objects; no numeric quota/SLA published. Partition files can require full streaming decompression. | Irregular releases; current index link dated 2026-08-13, hosting moved July 2026. Imagery dates vary and are older than release dates. | B; map `-1` to missing, never negative roof height. **Viable direct alternative if avoiding building ODbL**; lower/uncertain heights remain a quality limitation. [Pinned README](https://github.com/microsoft/GlobalMLBuildingFootprints/blob/c691ea1a09dfe9bd91b8e1db7ee31e7b6b3c7fbe/README.md), [CDLA terms](https://cdla.dev/permissive-2-0/). |
| **B4 Google Open Buildings v3 footprints** — Africa, South/SE Asia, Latin America/Caribbean | Vector footprints and detection confidence; **no height field** in footprint product, no vertical datum. No universal geometric error bound; detection metrics do not certify complete coverage. | Dual **CC BY 4.0 or ODbL**: select CC BY 4.0 for the direct download and retain Google/source attribution, licence and modification notice. | Public download $0; no guaranteed quota/SLA found. | Versioned research releases, no promised continuous update. | B; heights require a separate source or explicit existing default. Particularly relevant outside US/EU. [Publisher](https://sites.research.google/gr/open-buildings/). |
| **B5 Google Open Buildings 2.5D Temporal v1** — same broad southern-region coverage, 2016–2023 | Annual raster building presence, counts and height; **4m effective resolution**, although delivered at 0.5m. Relative building height, not geodetic absolute tops. No per-pixel hard height bound in catalogue; local error unvalidated here. | Choice of CC BY 4.0 or ODbL; choose/document CC BY for direct use; retain Google and source notices. | $0 direct Google Cloud Storage download; Earth Engine is optional and its account/commercial-service costs must not be assumed free. No GCS dataset-specific request guarantee published. | Eight historical annual slices; this does not promise a 2024–2026 refresh. | B; select epoch and presence/height recipe explicitly; missing pixels remain unknown. This is an additional modeled-height source, not surveyed roof geometry. [Catalogue and direct-download link](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1). |
| **B6 MapTiler Cloud building tiles, existing display provider** — broad basemap coverage, source-specific gaps | Generalized/clipped vector tiles; display zoom is not native survey resolution. Render height/base fields have no universal stated height accuracy or geodetic datum. Tile clipping cannot establish the whole-feature foundation. | Cloud service contract plus upstream attribution, including OSM where used. Standard caching/derivative permissions do **not** establish a right to bulk-export buildings into Umbra's public normalized raster CDN. | Free $0: 100k API requests/month; Flex starts $30/month: 500k. Fixed requests/second not established; free quota exhaustion suspends service. | Provider-controlled; no building-specific resurvey cadence. | B, plus authorization/quota failures. **Excluded as canonical bulk source without appropriate redistribution rights**; existing display use is unchanged. [Terms](https://www.maptiler.com/terms/cloud/), [pricing](https://www.maptiler.com/cloud/pricing/). |

### 3.2 Canopy

| ID / coverage | Native resolution; datum and stated accuracy | Licence / attribution | Cost / limits | Cadence | Missing/error and use |
|---|---|---|---|---|---|
| **C1 WRI/Meta CHMv2**, official AWS plus Source Cooperative packaging — nearly global land **except Greenland/Antarctica**, local invalid cells | Nominal 1m ML **height above ground**; sampled COGs use 1.194329 projected metres, ≈0.909300m on ground in Madrid. U8 integer-metre heights, separate validity masks. Published held-out SatLidarV2 MAE **3.0m**, R² .86; GEDI footprint validation RMSE **6.4m**, MAE **3.1m**. Neither is a street-tree or maximum-height guarantee. | **CC BY 4.0** in current registry and June 2026 author archive; earlier paper conflicts (§7). Retain Meta/WRI 2026 dataset citation, source imagery credit to Vantor, access date, licence and modification notices. Data licence does not grant rights to imagery or model weights. | A official AWS; public Source Cooperative range access observed, no numeric dataset quota/SLA. Packaging/index is additional infrastructure, not a reliability guarantee. | v2 released 2026; update frequency **TBD**. Paper uses the same imagery base as v1, largely 2018–2020; release year is not canopy-observation year. | C. Best reviewed broad free canopy input; query masks and acquisition-date metadata. Crown base, species and transmission are not supplied. [Registry](https://registry.opendata.aws/dataforgood-fb-forestsv2/), [paper](https://arxiv.org/html/2603.06382v1), [packaging](https://github.com/taylor-geospatial/meta-chm-v2). |
| **C2 OSM trees/tree rows/tagged crown geometry** — global but sparse and uneven | Vector points/lines/polygons; tagged AGL height/crown diameter if present, otherwise existing shape/height priors. No universal resolution, vertical datum or measurement accuracy. | **ODbL**, OpenStreetMap contributors credit and derivative-database obligations, even if buildings use a different licence. | Same $0 / Overpass limits as B1. | Contributor edits; no canopy survey cycle. | C and B extraction rules; only fill raster unavailable/nodata support per 02. A missing tree tag is not known absence. [OSM terms](https://www.openstreetmap.org/copyright). |
| **C3 Classified regional LiDAR / matched DTM and vegetation surface** — project footprints, not global | Project point density and derived grid spacing must be recorded separately. CHM is a **difference** of aligned surface and ground; absolute LAS/DSM heights retain project datum. Ground survey accuracy does not alone establish treetop/crown-base accuracy. No single worldwide stated error. | Project-specific: USGS public-domain surveys offer one route; EA OGL is another. Do not infer that all municipal or commercial LiDAR is open. Carry source/project notices into derived CHM and bounds. | Public projects P; commissioned/commercial coverage is quote-based, no universal free allowance. Processing/point-cloud storage costs additional. | Individual surveys, often years apart; leaf-on/off and capture date matter. | C/T/V. Use classifications/quality reports and matched datums/epochs; DSM minus DTM alone also contains buildings, so it is not automatically vegetation. The selected project must have its own admission record before use. [USGS products](https://www.usgs.gov/faqs/what-projection-horizontal-datum-vertical-datum-and-resolution-a-usgs-digital-elevation-model), [EA example](https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-digital-terrain-model-dtm-1m). |

[OBSERVED] Six CHMv2 COG metadata probes succeeded: Madrid, Kent, Singapore,
Nairobi, São Paulo and Jakarta. This refutes the old assumption that the reviewed
free raster endpoint only reaches US/EU cities. It **does not** measure valid-cell
coverage, crown correctness, complete national coverage or browser throughput.
The paper also reports mean imagery geolocation accuracy **8.7m**; a roughly 1m grid does not establish roughly 1m crown placement.
The mirror's README discusses reference-only STAC/Zarr assets while its `/chm/`
COG URLs also responded successfully; pin the actual asset URL, ETag/hash and
licence rather than inferring storage behaviour from that prose.
See [raster metadata](./evidence/03/raster-metadata.json).

### 3.3 Vertical grids and non-measured parameters

| ID / dataset and coverage | Native spacing / reference / stated accuracy | Licence and attribution | Cost / limits / cadence | Failure |
|---|---|---|---|---|
| **V1 NGA EGM96 geoid grid** — global | PROJ `us_nga_egm96_15.tif`, 15′ grid of geoid separation; height above WGS84 ellipsoid ↔ EGM96. Model/grid resolution is not terrain resolution; no per-region hard error bound. | Public domain US government grid; retain NGA/model citation and conversion provenance. | A-equivalent public PROJ CDN, no published dataset quota/SLA; fixed geoid model, packaging revisions separately versioned. | V. [Grid provenance/licence](https://github.com/OSGeo/PROJ-data/blob/master/us_nga/us_nga_README.txt). |
| **V2 NGA EGM2008 grid** — global | PROJ `us_nga_egm08_25.tif`, 2.5′; together with V1 converts explicit WGS84+EGM2008 heights. Registered operation accuracy for sampled AOI **1.113m**, not a hard guarantee. | Public domain; NGA/model and grid provenance. | Same as V1; large global grid need not be redownloaded per region. | V. [NGA grids](https://github.com/OSGeo/PROJ-data/blob/master/us_nga/us_nga_README.txt). |
| **V3 NOAA NAVD88 geoid/frame grids** — regional US realizations | GEOID18 CONUS grid 1′, relates NAD83(2011), epoch 2010, to NAVD88. Historical NAD83/HARN assets need their matching registered chains. Datum probe offers a Kent chain with **2.1m** operation accuracy; no general centimetre-level EGM96 claim. | NOAA PROJ grids public domain; retain model/realization credits. | Public CDN A-equivalent; model releases, not live corrections. No numeric request guarantee. | V. [NOAA grid inventory](https://github.com/OSGeo/PROJ-data/blob/master/us_noaa/us_noaa_README.txt). |
| **V4 IGN EGM08-REDNAP** — mainland Spain/Balearic area of operation | Grid maps Alicante heights to ETRS89 ellipsoidal heights; use registered EVRF2000/Alicante and frame operations plus V1 for Madrid. Full chain's published PROJ/EPSG accuracy **2.15m**. Observed grid **841×541 at approximately 1′** (0.01666666°); metadata/ranges read, no height transformation performed. | **CC BY 4.0**, derived from IGN data. Include IGN attribution, source/grid licence and transformation/modification notice. | Public PROJ CDN A-equivalent; static model/versioned packaging; no numeric request quota. | V. [IGN grid provenance](https://github.com/OSGeo/PROJ-data/blob/master/es_ign/es_ign_README.txt). |
| **V5 EGG2008 quasigeoid, exact EU-DEM construction model candidate** — Europe | Full model 1′×1′; public coarse sample 10′×15′. ISG describes GRS80/zero-tide and EVRF2007 for the distributed model; this is not an automatic match to EU-DEM's documented EVRS2000. No coarse-grid error certificate for reproducing EU-DEM normalization. | Full-resolution model **not public domain**, supplied on request under provider conditions. Public access to coarse grid is not by itself an explicit redistribution licence. | Coarse access $0; full-model terms/cost not publicly established. Static 2008 model; no API quota/SLA. | V. Exact inversion remains unresolved; a licensed nominal-CRS alternative exists for Spain (V4), not a demonstrated pan-European replacement. [ISG record](https://www.isgeoid.polimi.it/Geoid/Europe/europe2008_g.html). |
| **V6 Existing canopy/height priors** — wherever measured attributes are absent | No native spatial resolution/datum/accuracy: model parameters, not observations. Preserve `C0=G+0.35h`, leaf-on/off transmission 0.10/0.70 and the existing building height/default policy with provenance. | Umbra model/code; underlying datasets keep their licences. | No external data fee/rate limit; version with recipe, not annually. | Missing observations stay marked inferred/default. Priors never establish real-world completeness or a certified maximum. [02 §4](./02-architecture.md). |
| **V7 LINZ NZGeoid2016 and national frame/local-datum grids** — New Zealand | NZVD2016 ↔ NZGD2000 ellipsoidal heights, then matching frame operation and V1 to EGM96; thirteen local-datum grids also available. Selected grid spacing and full-chain accuracy not measured in this discovery; record actual operation/grid metadata before use. | **CC BY 4.0**, LINZ attribution and grid/modification provenance. | Public PROJ CDN $0; no published dataset-specific quota/SLA; static models, versioned grids/frame corrections. | V. T10 dependency; the 1m terrain spacing is not geoid-grid resolution. [Provider inventory](https://github.com/OSGeo/PROJ-data/blob/master/nz_linz/nz_linz_README.txt). |
| **V8 NRCan HT2 and frame grids** — Canada, realization-specific coverage | `ca_nrc_HT2_1997.tif`, `HT2_2002v70`, `HT2_2010v70` connect CGVD28 and respective NAD83(CSRS) ellipsoidal realizations; then a matching frame operation and V1 can reach EGM96. Grid spacing and full-chain accuracy are operation-specific, not established for an unidentified legacy AWS asset. | **Open Government Licence – Canada**; required acknowledgement and NRCan/grid provenance. | $0 public PROJ CDN; no dataset quota/SLA published; static model versions, no live-correction cadence. | V; never apply a CGVD2013 grid as if it described CGVD28. [Provider inventory](https://github.com/OSGeo/PROJ-data/blob/master/ca_nrc/ca_nrc_README.txt). |

## 4. Datum: what the endpoint actually establishes

### 4.1 Confirmed mixed provenance, unresolved delivered vertical reference

[OBSERVED] At the same public Terrarium endpoint, z14 and z15 Madrid identify
`eudem/eudem_dem_5deg_n40w005.tif`; Kent identifies
`ned13/imgn48w123_13.tif`. This independently confirms 02d's finding.
Singapore z15 identifies `srtm/N01E103.tif`. All observations, URLs and response
headers are in [terrain-levels.json](./evidence/03/terrain-levels.json).

[PUBLISHED] The source datums are respectively EVRS2000/EGG08, normally NAVD88 for
this CONUS NED product, and EGM96. The source filename proves provenance, **not**
whether a producer already transformed those numbers. The producer's
[format document](https://github.com/tilezen/joerd/blob/0b86765156d0612d837548c2cf70376c43b3405c/docs/formats.md)
places its explicit EGM96 statement under **Skadi**; it is not an explicit
Terrarium/GeoTIFF global vertical contract. EPSG:3857 is horizontal and does not
resolve that ambiguity.

[OBSERVED / CODE] The sampled AWS GeoTIFF has no vertical CRS key. Inspection of
the pinned public joerd compositor found horizontal reprojection/resampling,
not a general EGM96 transformation contract. The public revision is **not proof
of the deployed producer or every preprocessing step**. Thus neither “all AWS
values are already EGM96” nor “every tile definitely retains its original datum”
is established. Source-specific vertical metadata/producer confirmation or
comparison to identified original assets and independent control is required.

[DESIGN] Prefer direct, identified native assets where their datum is documented.
Do not apply NAVD88→EGM96 or EU-DEM→EGM96 blindly to a mosaic that may already
have been transformed. At mixed-source seams, a tile-wide contributor list is
insufficient to undo blending after the fact. Convert each admitted input to the
canonical reference **before** compositing/resampling across sources.

GMTED is a second trap: its technical report says most heights reference EGM96,
but preprocessing standardized source characteristics **except vertical datum**.
Its source table includes local/national references. Its min/max layers therefore
also require source-aware normalization; “global GMTED” is not a sufficient datum
declaration. [USGS technical report](https://pubs.usgs.gov/of/2011/1073/pdf/of2011-1073.pdf).

### 4.2 Available transformations and limits

For a declared WGS84 ellipsoidal height `h`, `H96 = h − N96`. For declared
WGS84+EGM2008 heights, `H96 = H08 + N08 − N96`. These formulas do not make a
national orthometric datum interchangeable with WGS84; horizontal frame,
realization, epoch, tide convention, operation area and grid sign must be part of
the transform definition. AGL building/CHM differences receive **no geoid offset**.

[OBSERVED] PROJ 9.8.1 / pyproj 3.8.0, network disabled, `allow_ballpark=False`,
found the following registered paths for small AOIs at the probe sites:

| Input / output | Available licensed path | What remains unresolved |
|---|---|---|
| Kent, nominal NAD83+NAVD88 (EPSG:5498) → WGS84+EGM96 (9707) | Several regional chains using NOAA geoid/frame grids and NGA EGM96; first listed accuracy 2.1m, grids marked open-licence | Original NED horizontal realization and AWS preprocessing must be identified. Picking GEOID18 solely because it is newest is wrong. |
| Madrid, nominal ETRS89+EVRF2000 (7409) → 9707 | Registered EVRF2000→Alicante→ETRS89→WGS84→EGM96 path; IGN EGM08-REDNAP + NGA EGM96, accuracy 2.15m; IGN CC BY obligation | Not an exact demonstrated inversion of AWS's EU-DEM/EGG08 construction. Publisher's EVRS2000 wording and actual asset realization require verification. Other European regions need their own operation coverage. |
| Copernicus nominal WGS84+EGM2008 (9518) → 9707 | NGA EGM2008 and EGM96 public-domain grids; first operation accuracy 1.113m | Validate actual raster CRS/reference and selected grid pipeline; source DSM error remains. |
| Direct ArcticDEM ellipsoidal height → EGM96 | Subtract NGA EGM96 separation after horizontal positioning | Registration/model errors, masks, source version and DSM interpretation remain. |
| EA ODN / other national references → EGM96 | Requires that datum's national vertical operation, then compatible ellipsoidal frame and V1 | This work does not certify a selected grid chain/licence for every legacy national AWS asset. Such assets remain unadmitted; producer metadata does not identify enough to do so. |

**These were operation-discovery probes, not successful height transformations.**
Required grids were not installed; all three tested compound-CRS groups had zero
locally available operations and listed missing downloadable grids. This establishes
documented paths and licensing metadata, not a measured residual at a benchmark.
Grid licences were checked against PROJ-data provider READMEs rather than trusting
the `open_license` flag alone. Evidence:
[operation results](./evidence/03/datum-operations.json),
[reproduction](./evidence/03/datum_probe.py).

[DESIGN] A normalized manifest records source vertical CRS and realization,
operation/pipeline, grid identifiers and hashes, area of validity, stated statistical
accuracy, quantization error and transformation validation results separately.
Fail V when these are missing. Transformation uncertainty is not repaired by
rounding a resulting height outward by one quantum.

## 5. Bounds hierarchy: provider capabilities and required normalization

### 5.1 What can be obtained without downloading fine regional data?

Here “certified” has two distinct meanings. A computation can conservatively bound
**every value in a pinned normalized model**. None of the reviewed datasets
certifies **every real-world obstacle**, including absent buildings, unobserved trees
and measurement errors. Normalization can supply the first guarantee; it cannot
manufacture the second. Confidence must preserve that distinction.

| Candidate metadata / product | Terrain min/max over unloaded fine data | Absolute building/canopy tops | Verdict for 02 §7.2 |
|---|---|---|---|
| AWS source headers and footprint catalogue | Source names and horizontal support, no complete conservative extrema index | None | Provenance discovery only. |
| GMTED2010 minimum/maximum products | **Yes, numerical aggregates of their own historical source windows**; downloading coarse extrema can avoid fetching those fine inputs | No buildings/canopy-specific tops, no normalized Umbra foundations | Usable only if the declared field and datum treatment are provably covered by those inputs. Cannot certify newer NED/Copernicus/CHM/OSM regions. |
| COG IFDs, ordinary statistics and overviews | No guarantee: statistics may be absent, approximate or in a different datum; average overviews do not preserve maxima | Sampled CHMv2 has no GDAL extrema metadata; masks still need reading | A COG is an access layout, not a certified bounds service. |
| Overture/Parquet statistics and height filter | No ground extrema | Relative attribute min/max may exist for a row group; height ≥900m rejection only limits accepted attribute values, not unknown heights, complete geometry or absolute foundation+roof | Cannot skip full relevant feature selection and normalization. |
| U8 CHM representable range | No ground extrema | An encoding ceiling bounds represented AGL values, not `G+h`, missing cells or true canopy height | May be a very loose domain constraint after validating schema/support; not a complete top-height index. |
| CDEM published national value range | Product specification lists −226 to 5,959m in CGVD28; a coarse whole-product domain constraint | No building/canopy-specific tops | Does not certify later AWS blends, transformed heights or real-world error; cannot establish local coverage or replace the normalized regional hierarchy. |
| LINZ exact-statistics candidate + LERC error contract | Sample AS21 IFD reports min **−2.279000m**, max **203.882004m**, only **0.84% valid**; encoding error ≤0.001m native | Ground stats do not bound building/CHM tops or missing support | Potential raw-file envelope if full-statistics provenance is verified, expanded for encoding/interpolation and datum effects. This metadata probe did not certify that lineage or fill the other 99.16%. |
| LAS header Z range / point-cloud spatial nodes | Numerical raw-point bounds may be obtainable per file | Not class-specific complete roof/vegetation bounds, nor bounds after reprojection/classification/interpolation | Project-specific input aid; scan/classify and derive the actual field before certifying its hierarchy. |

[DESIGN] Do not substitute the maximum seen in the first downloaded tiles,
the 02d Madrid 117m normalized building maximum, a guessed global tallest tree,
or a fixed acquisition ring. A finite data encoding and a publisher's filtering
rule are not real-world completeness certificates.

### 5.2 What the regional normalizer must compute

1. **Pin the source selection and its coverage.** Obtain complete intersecting
   assets/features, including boundary-crossing polygons, relations, holes and
   neighboring terrain support. Fetch required validity/date/quality masks. Mark
   not-acquired, nodata and known-empty separately. A successful download of a
   bounding box is not proof that the feature extractor included every relation.
2. **Normalize ground first.** Apply the validated vertical/horizontal operation,
   then the selected interpolation on valid support and the settled z18 terrain
   surface. Scan the final normalized support including gutters/triangle vertices.
   Bilinear interpolation is within valid input extrema; cubic/Lanczos can
   overshoot, so raw input extrema alone are not a safe output bound.
3. **Compute complete-feature roofs.** Use surveyed base or the median of valid
   terrain samples around the full footprint boundary for `F`; normalize the
   relative height/default once, form `B=F+h`, then clip to tile support. Include
   applicable parts and conflict flags. Height ceilings do not supply `F`.
4. **Compute canopy tops and composition.** Read native selected positive CHM
   occupancy and masks, use nearest-neighbor sampling without bridging holes,
   form `C1=G+h` and the measured/prior underside. Apply 02's building/canopy
   interval clipping. Top bounds must enclose the resulting intervals and all
   possible support in the node, not an overview's mean canopy.
5. **Reduce exact leaves into a conservative tree.** Store `minG`, `maxG`,
   `maxB`, `maxC1`, separate source coverage/empty states, footprint and recipe
   identity. Compute in Float64 and round minima down/maxima up into the declared
   quantized representation. Parent bounds enclose all children; any unknown
   child propagates unknown for the affected component. Include numerical and
   coordinate-frame error in the traversal envelope, separately from source
   statistical accuracy. Empty components need an explicit sentinel/state.
6. **Publish the complete index with the immutable generation.** The browser can
   download this small hierarchy without downloading all fine caster tiles.
   A server has still had to inspect/normalize their sources. Build and validate
   distant source bounds before claiming a query is clear beyond the prepared
   region; an unprocessed neighbour cannot receive a finite bound by inference.

The work is at least proportional to the input support inspected: terrain and
canopy blocks, all relevant feature geometry/attributes, datum operations and
normalization/rasterization. It can stream in blocks and reduce bounds without
keeping the whole region in RAM. For a hierarchy of the delivered z18 field,
one scan during tile creation avoids a separate pass. A coarse outside-region
index may avoid writing all z18 tiles there, but still requires a conservative
derivation from the same declared source model, including building foundations.

### 5.3 First-region cost, with measured and unmeasured parts separated

Use 02d's Madrid extraction bbox `[-3.720,40.405,-3.690,40.427]` as an explicit
**scenario**, not a claim that this bbox is sufficient for all solar elevations.
Reproduction: [calculations.py](./evidence/03/calculations.py),
[results](./evidence/03/calculations.json).

| Work/storage item | Evidence or derived amount | Limitation |
|---|---|---|
| Full z18 tiles intersecting bbox | **23×22 = 506 tiles**, 33,161,216 cells, approximately 6.855km² full-tile area at centre latitude | Calculation, not a normalized production region. Exact AOI area is smaller. |
| Six 32-bit bands | **795,869,184B = 759MiB** per complete raw copy, before gutters | Stream tile-by-tile; no requirement to hold this whole region on a phone. |
| CHMv2 Madrid source object | **84,604,237B** object length observed by HTTP Content-Range; native height plane is **1GiB U8**, base packed validity mask **128MiB** | Whole object download is one option, not mandatory: range-fetch intersecting 512×512 blocks. An expanded byte mask uses more memory. Overview 1 used by 02d is not native data. |
| Candidate direct Copernicus Madrid terrain object | Base compressed block sums **30,283,245B GLO-30**, **3,674,787B GLO-90** from IFDs | Not total object size or AOI transfer; not proof this DSM can replace bare-earth `G`. |
| Buildings | 02d captured 5,658 closed ways; ingest complete feature/part selection and full foundations for production | Transfer bytes and feature count for a complete new extract **unmeasured**. Existing count is not a completeness certificate. |
| Minimal leaf extrema payload | 506×4 Float64 values = **16,192B**, plus parent nodes, masks, coverage and provenance | Illustrates index size, not a final serialized format or enough coverage outside the bbox. |
| Compressed normalized delivery | 506×02d's Madrid gzip+recipe mean 26,297.16B ≈ **13.31MB** | Extrapolation from 25 tiles, **not measured** for this region; excludes bounds/HTTP metadata and changed source/native-canopy effects. |
| Object storage/write cost scenario | R2 Standard $0.015/GB-month and $4.50/million Class A: ≈**$0.00020/month** for that modeled output and **$0.00228** for 506 writes, before account-wide free allowances | Excludes raw archive, grid storage, metadata objects, retries, minimum billing increments and compute-provider upload egress. [R2 prices](https://developers.cloudflare.com/r2/pricing/). |
| CPU, transformation, full-resolution normalization, index validation | **[UNMEASURED]**. At 02b's retained $32.19/720h compute scenario, incremental active compute is **$0.04471 × processing hours** | No first-region wall time, peak memory or all-in dollar total can be inferred from header probes. Scratch, downloads/uploads and labour are additional. |

The first query in a never-normalized region therefore has an **offline preparation
dependency**, not merely a few CDN misses. 02b's regional preparation → static CDN
→ worker/GPU placement remains viable; a first-region readiness latency within its
interactive budget remains **unmeasured**. 02d's 3° corridor already needed 94
tiles outside its captured set under finite, uncertified bounds. The 506-tile
scenario cannot close that uncertainty, much less certify every time or route.

## 6. Multi-resolution: exact levels and what they mean

### 6.1 AWS Terrain Tiles

[OBSERVED] HEAD probes at **17 levels for each of Madrid, Kent and Singapore**:
z0–15 returned 200, z16 returned 404 at all three sites. These are 51 site/level
observations, with a shared z0 URL; this is not an exhaustive world availability
test. For Terrarium, projected spacing is `156543.033928 / 2^z` metres, multiplied
by `cos(latitude)` for local ground spacing. Native source quality does not change
when those pixels are upsampled onto z18.

| z | Projected pixel spacing, m | Observed contributor families (tile-wide, not point-level) |
|---|---:|---|
| 0 | 156543.034 | ETOPO1 in all three |
| 1–4 | 78271.517, 39135.758, 19567.879, 9783.940 | GMTED **30″ mean** + ETOPO1 in all three |
| 5 | 4891.970 | ETOPO1 in all three |
| 6 | 2445.985 | GMTED **7.5″ mean** + ETOPO1 in all three |
| 7–8 | 1222.992, 611.496 | SRTM/GMTED, with ETOPO1 in Kent/Singapore |
| 9–10 | 305.748, 152.874 | Madrid EU-DEM; Kent/Singapore SRTM/GMTED/ETOPO1 |
| 11 | 76.437 | Madrid EU-DEM; Kent NED1/9 + NED1/3 + SRTM/GMTED; Singapore SRTM/GMTED |
| 12–14 | 38.219, 19.109, 9.555 | Madrid EU-DEM; Kent NED1/3; Singapore SRTM/GMTED |
| 15 | 4.777 | Madrid EU-DEM; Kent NED1/3; Singapore SRTM |

The archived nominal zoom/source table disagrees with some live observations
(notably z1–5); use retained object headers for what was delivered, and the
publisher's source specifications for native accuracy. A change in source family
across zooms means the pyramid is not simply reductions of one canonical DEM.
No per-level resampling error or conservative relation to z15/z18 is published.
Native accuracy is the T2–T5/T1-component catalogue, **not** the spacing column.

[OBSERVED] The sampled AWS `geotiff/13/4011/3088.tif` has 512×512 Float32
pixels at 9.554629 projected metres, equivalent in spacing to z14 Terrarium.
Its 256×256 blocks are **storage tiles**, not reduced-resolution images:
**one IFD, no embedded overviews** was found. Do not interpret the format
document's internal “pyramiding” wording as proof of selectable overview levels.
Other objects were not exhaustively inspected.

### 6.2 Direct terrain pyramids/products

| Source | Available levels | Native accuracy / validity of coarser levels |
|---|---|---|
| Copernicus GLO-30 COG, sampled N40 W004 | 3600² base 1″; 1800² at 2″; 900² at 4″; 450² at 8″. Rough north–south spacing 30/60/120/240m. | Base product LE90 <4m; **no independent overview accuracy stated**. AWS conversion uses **average resampling**, so neither maxima nor narrow ridges are preserved. |
| Copernicus GLO-90 COG, sampled N40 W004 | 1200² base 3″; 600² at 6″; 300² at 12″. Rough north–south spacing 90/180/360m. | Same product accuracy specification, not a claim that the 360m average locates a ridge within 4m. |
| Copernicus high latitudes | Base longitude cell count decreases by latitude band; overview dimensions also vary. GLO-30 row widths 3600/2400/1800/1200/720/360 from low to high bands. GLO-90 has special high-latitude overview widths; do not hard-code square cells or uniform longitude factors globally. | Read each IFD geotransform and the publisher's latitude-band table. Finer web zoom does not restore native detail. [COG layout/resampling](https://copernicus-dem-30m.s3.amazonaws.com/readme.html). |
| GMTED2010 | Separate **7.5″, 15″, 30″** products; min, max, mean, median, standard deviation, systematic subsample, breakline emphasis | Published RMSE by spacing in T5; no hard accuracy bound. Explicit min/max are the only reviewed terrain products designed to retain input-window extrema, subject to §5's lineage/datum limits. |
| SRTM | Separate **1″ and 3″** editions, not an arbitrary-zoom certified hierarchy | Same historical measurement family, different aggregation/release/void filling. No public residual bound between editions found. |
| USGS 3DEP | 1m, historical 1/9″, 1/3″, 1″ and Alaska products have different coverage/vintages; COG overviews are asset-dependent | **Not guaranteed levels of one acquisition.** 0.82m CONUS 1/3″ RMSE is a product assessment; no universal 1m→10m→30m error envelope. Inspect selected assets and build matching conservative reductions. |
| EU-DEM | Geographic 1″ and projected 25m distributions; AWS z9–15 observed | No documented extrema-preserving native multi-level hierarchy or per-level error. These representations and AWS upsampling do not add measurement detail. |
| PGC public mosaics | **2m, 10m, 32m, 100m, 500m, 1km** listed; strips native 2m | Reduced mosaics intended for cartography; PGC does not verify universal absolute vertical accuracy, nor publish conservative residuals by reduced level. |
| LINZ sampled AS21 COG | Base **24000×36000 at 1m**; overviews **12000×18000, 6000×9000, 3000×4500, 1500×2250, 750×1125, 375×562, 187×281**: approximately **2/4/8/16/32/64/128m**, with rounding in last levels | Native source accuracy approximately 20cm per storage guide, survey-specific. LERC errors **≤1mm native / ≤10cm overview** do not bound resampling loss. Sample has only 0.84% valid support. No conservative fine-to-overview residual certified. |
| Other national DEMs | Dataset-specific grids/overviews; no common global level list in AWS metadata | Not admitted as a shared pyramid merely because a TIFF has overviews. Inspect and record levels on each selected release. |

The published Copernicus latitude-band widths are explicit (each file spans one
longitude degree). GLO-30 height is 3600 at base and 1800/900/450 at overviews;
GLO-90 height is 1200 at base, with overview sizing read from the asset. Values
below are widths, not metres; the two highest GLO-90 bands have unusual rounding
in the publisher's table and must not be interpreted as uniform 2×/4× longitude
reductions. [AWS conversion table](https://copernicus-dem-30m.s3.amazonaws.com/readme.html).

| Absolute latitude band | GLO-30 base → overview widths | GLO-90 base → overview widths |
|---|---|---|
| 0–50° | 3600 → 1800, 900, 450 | 1200 → 600, 300 |
| 50–60° | 2400 → 1200, 600, 300 | 800 → 400, 200 |
| 60–70° | 1800 → 900, 450, 225 | 600 → 300, 150 |
| 70–80° | 1200 → 600, 300, 150 | 400 → 200, 100 |
| 80–85° | 720 → 360, 180, 90 | 240 → 100, 50 |
| 85–90° | 360 → 180, 90, 45 | 120 → 50, 25 |

[DESIGN] Distant **terrain-only** casters can be carried coarsely for scheduling
and provably clear-node rejection after constructing bounds of the selected fine
terrain. For a coarse surface `Gc`, one can store a conservative residual interval
enclosing all fine-surface values over its support, or use direct `minG/maxG`.
If the whole ray segment is above the upper envelope, skip. If inconclusive,
refine using the same field and datum; do not replace the fine ridge by a mean
and call the ray clear. Max pooling is an acceleration bound, not an opaque
coarse mountain. Source accuracy uncertainty remains separate from this exact
model-to-model enclosure. This preserves 02's leaf intersection semantics.

### 6.3 Canopy levels are available but do not change the crown contract

[OBSERVED] All six sampled CHMv2 assets have base **32768×32768** and six
height overviews **16384, 8192, 4096, 2048, 1024, 512** pixels per side,
with a separate mask IFD at every level: **14 IFDs total**, not 14 height levels.
Projected spacing is **1.194329, 2.388657, 4.777314, 9.554629, 19.109257,
38.218514, 76.437028m**. Native source height planes are U8 and have no scalar
nodata tag in these probes; the mask is essential. No overview-specific height
accuracy or conservative occupancy guarantee was found.

02d used overview 1 at approximately **1.819m Madrid / 1.617m Kent**, so its
compression results are not measurements of full native canopy delivery. The
settled nearest-neighbour, mask-aware fine occupancy must survive normalization;
do not turn a coarse positive pixel into a rectangular crown. Canopy overviews
do not authorize coarse caster substitution, and terrain-only coarse traversal
does not waive building/canopy bounds in an uninspected region.

## 7. Licence obligations before implementation

[DESIGN] Ship a machine-readable data manifest and a human-readable attribution
view alongside the normalized data. Each admitted source needs publisher,
dataset/release/asset identity, licence text or immutable link, required notices,
modifications, acquisition/access dates, geographic support and transformation
identity. Include these in downloaded/exported results where the source terms
require it. The MIT repository licence must not be presented as the licence for
all sample rasters, source snapshots or CDN data.

| Choice | Concrete obligation / consequence |
|---|---|
| OSM or Overture building/canopy data | Attribute OpenStreetMap contributors/Overture and applicable upstream providers; identify ODbL. Public use of an adapted database invokes share-alike and access to the derivative database or qualifying alteration material under ODbL §4.4/§4.6. A rendered image can be a Produced Work with §4.3 notice; that does **not** make the database behind it exempt. Treat feature-derived normalized height/occupancy tiles and bounds conservatively as database derivatives for delivery planning, rather than relying on “raster means exempt.” [ODbL](https://opendatacommons.org/licenses/odbl/1-0/). |
| Mixing sources in the six-band tile | Merely storing ODbL and CC BY inputs in different source folders does not settle the status of the fused database. Maintain source-separated normalized inputs and reproducible modifications, with a reviewed combined-data distribution/licence plan. Overture's own compatibility decision does not automatically license every Umbra fusion. This affects the **data**, not an automatic relicensing of independent MIT engine code. |
| CHMv2, direct Google CC BY, current ArcticDEM, IGN grid | Preserve creator/source/copyright notices as supplied, CC BY link and modification indication; do not imply endorsement or add restrictions preventing licensed reuse. No CC BY share-alike clause, but attribution survives normalization. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode.en). |
| Copernicus DEM / EU-DEM | Carry the applicable product's prescribed notice, including the modified-product form where appropriate. Keep exact notice text from the selected licence with the source manifest; do not replace it with “open terrain.” GLO-30/GLO-90 and EU-DEM are different products with different notice wording. |
| Direct Microsoft current release | Include the **CDLA Permissive 2.0 agreement text** with shared data; that licence imposes no conditions on analytical Results. Pin actual assets/release licence. Overture's attribution page still credits a Microsoft source under ODbL; trust the licence attached to the **actual distribution being ingested**, not an organisation-wide assumption. |
| MapTiler Cloud | Standard free plan and display API access do not establish bulk extraction/public raster redistribution permission. Exclude this ingestion route unless suitable terms are obtained. A paid display quota alone is not such permission. |
| FABDEM | Noncommercial/share-alike restrictions are known now. Exclude from the unrestricted baseline; no silent substitution for free global ground. |

**CHMv2 licence conflict resolved for the selected dataset distribution:** the
March 6 arXiv v1 paper's Data Record says the AWS maps use the DINOv3 licence.
The current Meta-managed AWS registry explicitly says CC BY 4.0. More decisively,
the authors' **June 10, 2026 dataset archive** identifies the same S3 prefix in
its README and declares **`cc-by-4.0`** in its API metadata. Use that later,
dataset-specific grant and retain it with the assets; do not transfer the model's
licence onto the maps. The archive contains a README/pointer, **not a second
22TB backup**. The DINOv3 repository separately applies its custom licence to code
and model weights, which this ingestion path does not use. Evidence:
[author archive](https://zenodo.org/records/20628959),
[retained archive metadata](./evidence/03/sources/chm-zenodo-api.txt),
[retained archive README](./evidence/03/sources/chm-zenodo-readme.txt),
[model licence](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md).

Two feasible building-data paths are therefore explicit: **retain OSM/Overture
with the ODbL data-publication work**, or ingest **direct Microsoft CDLA and/or
direct Google CC BY** with their coverage/height limitations. Choosing the second
for buildings does not remove ODbL if OSM tree fallback remains enabled. Neither
path removes CHMv2 attribution. No production source is relabelled MIT here.

## 8. Non-US, non-EU coverage and the free-tier boundary

The practical global path is a **regional source recipe**, not a promise of
uniform worldwide street accuracy:

| Region / need | Realistic free-data path | Where it does not reach |
|---|---|---|
| Africa, South/SE Asia, Latin America/Caribbean | SRTM EGM96 or transformed Copernicus for broad elevation; direct Google/Microsoft or Overture/OSM buildings; CHMv2 canopy, with local masks and date checks | 30m reflective/DSM elevation cannot supply kerbs or reliably separate ground from roofs/forest. Building heights remain sparse/modeled/defaulted. CHM has metre-scale errors and old imagery. Nairobi/São Paulo/Jakarta probes establish asset access only. |
| Singapore and other dense tropical cities | Same broad stack; use identified local terrain/building survey data where publicly reusable | AWS Singapore z15 is SRTM, not a modern metre-scale DTM. Free buildings/CHM do not compensate for an incorrect ground receiver origin. Local detailed data may require a paid/restricted agreement. |
| Canada, Australia, New Zealand and other national-data regions | Replace coarse terrain with direct, identified national/regional open surveys after datum/licence admission; retain global sources outside project coverage | Old AWS regional layers are not evidence of present national quality/coverage. [LINZ now exposes free merged 1m DEM/DSM and point-cloud access](https://www.linz.govt.nz/products-services/data/types-linz-data/elevation-data/access-elevation-data), updated as new surveys arrive; actual coverage, vertical metadata and project accuracy still control admission. |
| High northern latitudes / polar land | Public ArcticDEM/REMA with ellipsoid→EGM96 conversion and masks; Copernicus/global coarse alternatives where applicable | Mercator itself stops near ±85.05°. Fresh Alaska EOCL-restricted data and much of EarthDEM are not generally public. DSM artifacts and unverified accuracy remain. |
| Any region requiring reliable sub-metre street ground, complete measured roof tops, crown undersides or seasonal optical properties | A suitable local open LiDAR/municipal survey may exist and must be admitted individually | **No reviewed global free dataset supplies this contract.** Commissioned/commercial survey pricing and redistribution rights are project-specific; no credible global per-km² quote was established. |
| Operational free tier | Anonymous source downloads plus a small prepared-region CDN can be inexpensive | Source availability is not an SLA; cold normalization, stored grids/raw archives and server time are real work. MapTiler free use is limited/noncommercial and quota-bound; Earth Engine commercial use is a separate service; Copernicus EEA-10 and FABDEM commercial reuse are not general free substitutes. |

[DESIGN] A DSM may be labelled a degraded ground proxy only with explicit
provenance/uncertainty under 02's evidence contract; it cannot be certified as
bare-earth receiver terrain by resampling to z18. For regions where an admitted
ground model is unavailable, report incomplete coverage rather than silently
double-counting vegetation/buildings already embedded in `G`.

## 9. Completion and remaining public-information limits

Every required dataset class has a row, including masks/metadata as source
dependencies, transformation grids and priors. The answers are sufficient to
avoid assuming a free bounds service, a global AWS datum, or an accurate
max-preserving provider pyramid. The following uncertainties remain explicit:

| Unresolved item | Why the reviewed public information cannot settle it | Consequence / evidence needed |
|---|---|---|
| Exact AWS delivered vertical datum, including mixed pixels and legacy national assets | Headers identify contributors; horizontal CRS and public compositor code do not document all deployed vertical preprocessing | Direct native assets with metadata, producer processing declaration, and control comparisons before admission. Never infer zero offset. |
| Exact EU-DEM EGG08 inversion throughout Europe | Full-resolution EGG2008 has access conditions; coarse public model has a different stated realization and no demonstrated reproduction accuracy | Exact asset metadata/model terms or validated regional registered transformations. Spain's licensed nominal path is available, but not a continent-wide exact solution. |
| Hard upper error/completeness bounds on real terrain, roofs and trees | Published statistical errors and model validation do not assert hard maxima; building/tree inventories are incomplete | Only certify the pinned normalized model's hierarchy; preserve source uncertainty. Normalization cannot establish unobserved truth. |
| Overview-specific vertical error or extrema relation to fine canonical terrain | AWS changes input families; Copernicus averages; most other overviews have no such public contract | Compute conservative residual/min-max reductions during normalization and refine ambiguous traversal. |
| Cold first-region elapsed time, complete input bytes and peak processing memory | This work inspected metadata and previous probes, not a full datum-correct native-canopy regional production build | Measure that build in implementation feasibility work; the byte/cost scenario in §5 is explicitly not a timing claim. |
| Guaranteed public-provider throughput, future refreshes and commercial local-survey prices | Reviewed providers generally publish no dataset-specific quota/SLA or fixed regional acquisition price | Bounded retry/cache policy, dated snapshots and project-specific source admission. No invented unlimited/free-service promise. |

Receiver semantics remain settled: occupied ground receivers are invalid before
bias/night handling; wall/roof receivers retain their actual heights; empty-valid
sidewalks return null with zero confidence and each side keeps its own validity
fraction. Dataset absence must not be converted into a known sun/shade value or
used to change those rules. No branch, application edits or production activation
are part of this deliverable.
