# Daiko

A request queue for events, built with React/Vite, Fastify, Prisma, and SQLite. Daiko uses ParcelHub's existing Better Auth login; it does not keep passwords or a copy of ParcelHub's database.

## How it works

- Sign in using a ParcelHub account. ParcelHub controls account creation, referrals, password recovery, and account disabling.
- Event cards are ordered by event date and time. Choose an event, then submit a cheki request (amount and message) or a goods request (details).
- An administrator can create events with a name, group, date/time, and optional direct image URL, and review each event's requests in submission order. Requester identity and request details are recorded at submission time.
- The administrator is configured separately with `DAIKO_ADMIN_EMAILS`; a ParcelHub administrator is not automatically a Daiko administrator.
- This initial version does not edit or delete events, change request status, upload images, or import events from external services.

## Local development

Install dependencies with `npm ci` in this directory and in `client/`. Copy `.env.example` to `.env` and configure the database, ParcelHub URL, administrator emails and allowed origin. Environment variables must be loaded into the shell before starting the API (Node does not automatically load `.env` here). Run `npx prisma migrate deploy`, then `npm run dev`; run `npm run dev` in `client/` for Vite. A local ParcelHub instance needs a matching trusted origin and cookie setup for interactive login. Production is served at the same origin as ParcelHub so existing sessions work across both apps.

Run `npm test` for backend tests and `npm --prefix client run build` for the frontend build.

## Homelab deployment

`compose.homelab.yml` runs separate Daiko API and web containers on ParcelHub's existing Docker network. Set `DAIKO_ADMIN_EMAILS` in a private `.env` and keep the SQLite `daiko-data` volume; never run `down -v` as part of an update. `deploy/parcelhub-nginx.conf` is based on the existing production configuration and adds Daiko routes. `deploy/parcelhub-override.yml` mounts it into ParcelHub's client container without changing its source checkout. The ParcelHub client must be recreated with both its original compose file and this override. Existing `/api/` and `/` routes are preserved, while `/daiko/` and `/daiko-api/` go to Daiko. If ParcelHub's Nginx configuration changes later, merge those changes into the Daiko override before recreating its client.

The Daiko API checks both the ParcelHub session and a guarded ParcelHub endpoint on each authenticated request, so disabled accounts are rejected. ParcelHub and Daiko must remain on the same trusted Docker network; do not publish the Daiko API directly. Back up Daiko's SQLite volume separately from ParcelHub before upgrades.

### Backups and rollback

With commands run on the host from `/root/Daiko`, stop the API before copying the database so the snapshot includes a consistent SQLite state. The web container may remain running; requests fail temporarily while the API is stopped. Do not delete the volume.

```sh
mkdir -p backups
chmod 700 backups
docker compose -f compose.homelab.yml stop api
docker run --rm -v daiko_daiko-data:/source:ro -v "$PWD/backups:/backup" alpine:3.20 sh -c 'cp /source/daiko.db /backup/daiko-$(date +%Y%m%d-%H%M%S).db'
docker compose -f compose.homelab.yml up -d api
```

Copy the backup to separate storage. To remove only the routing integration, recreate ParcelHub's client using its original Compose file without the Daiko override. Daiko's containers and data volume remain intact. For normal ParcelHub updates, include `-f /root/Daiko/deploy/parcelhub-override.yml` after the original Compose file when recreating the client; otherwise the Daiko routes will disappear. Check `nginx -t` and both applications after changes.
