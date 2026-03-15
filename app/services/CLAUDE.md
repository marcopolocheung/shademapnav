# services/

## Purpose

Client-side service wrappers for third-party APIs.

## Conventions

- Services must read Vite-exposed API keys from `import.meta.env.VITE_*`.
- Prefer **single-call** API usage where possible.
- Use a small in-memory cache (session lifetime) when the same lookup is likely
  to be repeated (e.g., clicking the same waypoint multiple times).

## Key Files

- `foursquare.ts` — Foursquare Places API v2 wrapper; exports `getPlaceDetails` and `getPlaceInfoFromAddress`; TTL cache (1 hr); handles rate-limit and auth-block responses gracefully; in dev, CORS-proxied via `/__fsq` rewrite in `vite.config.ts`; requires `VITE_FOURSQUARE_API_KEY` in `.env.local`

# Foursquare API — Available Data Fields

> **Note:** The fields listed below represent the **only available data** when querying the Foursquare API. No additional fields or attributes are accessible beyond what is documented here.

| What | Type | Description |
|---|---|---|
| `fsq_place_id` | String | The unique identifier of a Foursquare POI (formerly known as venueid or fsq_id). Use this ID to view a venue at foursquare.com by visiting: `https://foursquare.com/placemakers/review-place/{fsq_place_id}` |
| `name` | String | Business name of a POI |
| `latitude/longitude` | Decimal | Foursquare latitudes and longitudes are delivered as decimal degrees (WGS84 datum). Default geocode type is front door or rooftop, where available. Derived by a combination of: direct input from third party sources, direct input of precise latitude/longitude (a pin drop) from initial user creation and correction |
| `address` | String | User-entered street address of the venue |
| `locality` | String | City, town or equivalent the POI is located in |
| `region` | String | State, province, territory or equivalent. Abbreviations are used in the following countries (US, CA, AU, and BR). Remaining countries use full names |
| `postcode` | String | Postal code of the POI, or equivalent (zip code in the US). Format will be localized based on country (i.e. 5-digit number for US postal code) |
| `admin_region` | String | Additional sub-division. Usually, but not always, a country sub-division (e.g., Scotland) |
| `post_town` | String | Town/place employed in postal addressing. May not reflect the formal geographic location of a place |
| `po_box` | String | Post Office Box |
| `country` | String | 2 Letter ISO Country Code |
| `date_created` | Date | The date the POI entered the database. This does not necessarily mean the POI actually opened on this date |
| `date_refreshed` | Date | The date the POI last had any single reference refreshed from crawl, Listing Syndicators, users or human validation |
| `date_closed` | Date | The date the POI was marked as closed in the database. This does not necessarily mean the POI actually closed on this date |
| `tel` | String | Telephone number of a POI with local formatting |
| `website` | String | URL to the POI's (or the chain's) publicly available website |
| `email` | String | Primary contact email address of organization, if available |
| `facebook_id` | String | This POI's Facebook ID, if available |
| `instagram` | String | This POI's Instagram handle, if available |
| `twitter` | String | This POI's Twitter handle, if available |
| `fsq_category_ids` | Array (String) | ID (or IDs) of the most granular category (or categories) available for this POI |
| `fsq_category_labels` | Array (String) | Label (or labels) for the most granular category (or categories) available for this POI |
| `name_translated` | String (JSON) | User-entered translated name(s) of a venue, including an ISO 639-1 language code. Format: `[{Translated Venue Name, language code}]`. Generally only exists for very popular POIs |
| `neighborhoods` | Array (String) | The neighborhood(s) or other informal geography in which this POI is found |
| `census_block_id` | String | The 15-digit Census Block GEOID for the census block containing the POI's coordinates. Populated only for Places within the United States |
| `dma` | String | DMA (Designated Market Area, as defined by Nielsen) the POI is located in. Signifies a region where the population can receive similar TV and radio offerings in the USA. There are 210 DMAs in the United States |
| `fsq_chain_ids` | Array (String) | The chain ID(s) of a POI. Use in conjunction with `fsq_chain_name` |
| `fsq_chain_names` | Array (String) | Standardized chain name of a POI. Use in conjunction with `fsq_chain_id` |
| `chain_store_id` | String | The unique ID assigned to a venue to differentiate it from other stores within the same chain |
| `subvenue_count` | String | If a POI is a parent POI (e.g. a mall), indicates how many child POIs (stores) it is a parent of |
| `parent_id` | String | The Foursquare ID of a POI's parent venue. Foursquare maintains parent/child relationships for POIs located inside other POIs (e.g. stores in malls) |
| `placemaker_url` | String | A link to the POI's review page in the PlaceMaker Tools application, where users can suggest edits or review pending corrections |
| `unresolved_flags` | Array (String) | Quality issue flags reported by Placemakers requiring further corroboration. Possible values: `closed`, `duplicate`, `delete`, `privatevenue`, `inappropriate`, `doesnt_exist` |