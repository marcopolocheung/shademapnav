# The external half of the Umbra rename

**Status: not started, and deliberately so.** The rename that landed changed everything
inside this repository — code, docs, UI copy, browser storage keys, the service-worker
cache. It changed nothing that a stranger types or that a third party has recorded. Those
are still `shademapnav`, and this page is the list of what it would take to move them.

The split exists because the two halves have different risk. The internal half is
reversible and its blast radius ends at the repo. The external half breaks other people's
links, and one of its steps — moving to a different origin — silently abandons every
user's saved data.

## Why the old name is still in the tree

Every `shademapnav` below is an address something outside this repo still resolves — a live
origin, a repository path, a link already shared. They are deliberate, not leftovers:

| Still says `shademapnav` | Where |
|---|---|
| Production origin | `api/fsq.js`, `api/agent.js` (CORS allowlists), `api/overpass.js`, `api/nominatim.js` and `vite.config.ts` (`User-Agent` contact URL) |
| Repository and public mirror | `.github/workflows/mirror.yml` (`MIRROR_REPO`), `README.md`, `docs/tracks/**`, `docs/handoffs/**` |
| Method link shown in the UI | `app/components/RouteConditionsLine.tsx` |
| Test fixtures asserting the above | `app/lib/__tests__/agentProxy.test.ts`, `app/lib/__tests__/fsqProxy.test.ts` |

The `User-Agent` product token is already `Umbra/1.0`; only the contact URL inside it is
the old address, and it must keep pointing somewhere that actually resolves — an
unreachable contact URL is worse under the OSMF policy than an old one.

## What the cutover covers

1. **Rename the GitHub repository and the public mirror.** GitHub redirects the old path,
   so clones and the `raw.githubusercontent.com` citations in `docs/research/**` keep
   working — until someone else claims the freed name. Update `MIRROR_REPO` in the same
   change; the mirror push targets the name literally.
2. **Move the hosting address.** A new Vercel project name changes the origin.
3. **Update the origin allowlists** in `api/fsq.js` and `api/agent.js` to the new origin,
   keeping the old one until step 5 is done.
4. **Update the contact URLs** in the two proxy `User-Agent` headers and the dev proxy in
   `vite.config.ts`, and the method link in `RouteConditionsLine.tsx`.
5. **Keep the old origin serving a redirect** for as long as shared links are worth
   honouring. Share links are plain query strings (`?lat…&a=…&b=…`, see
   `app/lib/shareState.ts`) and carry no first-party name, so a redirect that preserves
   the query string preserves the scene exactly.

## The step that loses data

Browser storage is per-origin. `app/lib/storageMigration.ts` moves `shademapnav:*` keys to
`umbra:*`, but only within one origin — it cannot reach data held by a different host.
Moving the app to a new origin therefore strands every saved route, folder, recent search,
saved place and preference on the old one, and no server-side change can recover them:
this app has no account and no server-side store.

Anything short of leaving those users behind means a transfer the app performs itself —
the old origin handing its `umbra:*` payload to the new one, through a redirect that
carries it or a page the user visits once. That is a feature to design, not a step to
schedule, and it is the reason this cutover is not simply the next checkpoint.

## What is already safe

The service-worker cache (`umbra-shell-v1`) and the storage-key migration both handle the
upgrade-in-place case, and `e2e/rebrand.spec.ts` covers them: a legacy cache is replaced on
activation, and legacy routes — including the renamed nested fields and the `Most shaded`
category — are read, converted and re-listed. Those tests are about a returning visitor on
the *same* origin, which is what a rename without a move produces.
