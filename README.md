# Millionaires' Row

**A searchable, mapped explorer of NYC's 2027 pied-à-terre tax roll.**

Live at **[millionairesrownyc.com](https://millionairesrownyc.com)**.

In July 2026 the NYC Department of Finance published its supplemental property
roll — the ~960,000 properties that *may* be subject to the state's new
non-primary-residence surcharge (condos/co-ops valued at $1M+, one- to
three-family homes above $5M). This site makes that public record explorable:

- **Search** any owner name or street address — find yourself, your neighbor,
  or a bold-faced name.
- **Property pages** with the full detail: DOF full market value, owner,
  tax/building class, borough/block/lot.
- **Multi-property owners flagged** — 61,866 owners hold more than one
  property on the roll; each owner page lists their whole portfolio.
- **A map of every property**: white lines and squares on a black outline of
  NYC — no basemap, just the data.

Total valuation on the roll: about **$1 trillion** across 959,710 properties.

> Inclusion on the roll does **not** mean the tax applies — DOF itself says
> the list only identifies properties that *may* be subject to the surcharge,
> and press coverage found plenty of primary homes on it.

## Stack

- **Next.js 15** (App Router, TypeScript) — UI + API routes
- **PostgreSQL 16** — full roll with trigram search indexes
- **MapLibre GL JS** — custom white-on-black style, no external tile servers
- **Data pipeline** — bash + SQL scripts joining the DOF roll to NYC PLUTO
  for coordinates (100% coverage)

## Local development

Raw DOF CSVs go in `data/raw/` (gitignored):
`supplemental_roll_TC1_2027.csv`, `supplemental_roll_TC2_2027.csv`.

```bash
# 1. Postgres (host port 5435)
docker compose -f docker-compose.dev.yml up -d

# 2. Either: quick 10k-row sample db (mrow_dev, fake coords)
./scripts/dev_sample.sh

#    Or: the full pipeline (mrow db, real PLUTO coordinates)
./scripts/import.sh        # load 960k rows
./scripts/geocode.sh       # download PLUTO, join coordinates
./scripts/build_owners.sh  # owners table + indexes
./scripts/dump_seed.sh     # production seed dump -> data/seed/mrow.dump

# 3. App
npm install
npm run dev                # uses DATABASE_URL from .env.local
```

`DATABASE_URL` examples:
`postgres://mrow:mrow@localhost:5435/mrow` (full) or `.../mrow_dev` (sample).

## Deployment (Dokploy, git-based)

Each Dokploy instance runs the whole stack from this repo — app + its own
Postgres 16, seeded automatically from the committed `data/seed/mrow.dump`
(60 MB) on first boot. The data is a static public record, so the two
instances never need to sync.

On **each** Dokploy instance:

1. Create a **Compose** service pointing at
   `https://github.com/digitalhen/millionaires-row`, branch `main`,
   compose file `docker-compose.yml`.
2. Environment: set `POSTGRES_PASSWORD` to something real. The site URL is
   baked into the image at build time via the `NEXT_PUBLIC_SITE_URL` build
   arg (defaults to `https://millionairesrownyc.com` in the Dockerfile —
   override per-instance only if needed).
3. Add the domain `millionairesrownyc.com` to the `app` service (port 3000);
   Dokploy's Traefik will provision the Let's Encrypt certificate.
4. Deploy. First boot takes ~1–2 min while the `seed` one-shot restores the
   dump; subsequent deploys skip it (it detects the existing `properties`
   table).

To refresh data later: rebuild the dump locally (`scripts/` pipeline), commit
it, push, then on each instance drop the `pgdata` volume (or
`DROP TABLE properties, owners` and re-run the seed service) and redeploy.

Local production rehearsal:

```bash
docker compose -p mrow-prod up -d --build
docker exec mrow-prod-app-1 wget -qO- http://127.0.0.1:3000/api/stats
```

## Data & provenance

- NYC DOF 2027 supplemental property roll (public record, published July 2026
  under state law).
- NYC PLUTO (Dept. of City Planning) for parcel coordinates.
- NYC Open Data borough boundaries for the map outline.
- Values shown are DOF **full market value** estimates, not sale prices.
