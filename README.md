# ShadeMapNav

A personal open-source shaded-route navigation project for any location on Earth.
ShadeMapNav is an independent personal project and is not affiliated with ShadeMap.app.

Visit here: https://shademapnav.vercel.app/

## Quick start

```bash
cp .env.example .env   # then put your VITE_MAPTILER_API_KEY in it
npm install
npm run dev            # http://localhost:5173
```

## Evidence

Every measurement this project has made — with its method, its sample counts, and its worst
case — is on one page: **[docs/notes/evidence.md](docs/notes/evidence.md)**. It also names what
is *not* measured, which is most of it.

## Repo guide

The repository is self-describing for contributors and coding agents:
- **`CLAUDE.md`** (root) — commands, hard invariants, repo map, task→edit-point table. Start here.
- **`.claude/rules/`** — path-scoped rules that load themselves when you open a matching
  file (routing, the shadow renderer, components and the map, external APIs).

## License

[MIT](LICENSE).
