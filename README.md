# Daiko

A request queue for events, built with React/Vite, Fastify, Prisma, and SQLite. Daiko uses ParcelHub's existing Better Auth login; it does not keep passwords or a copy of ParcelHub's database.

The production site is `https://daiko.nekoj.in/`. Its existing Docker Compose project and volume retain the historical `daiko-staging` names; see [deployment notes](deploy/STAGING.md) before updating it. The older Daiko instance under `parcelhub.nekoj.in/daiko/` is separate and is not the production dataset.

## How it works

- Sign in using a ParcelHub account. ParcelHub controls account creation, referrals, password recovery, and account disabling.
- Event cards are ordered by event date and time. Choose an event, then either select a member and configured daiko type with a message, quantity, and optional image, or submit a text-only goods request.
- Users and administrators see upcoming events through the end of their date in Japan Standard Time (JST). Administrators can open older events and their request queues in Past events, with the newest past event first. Event dates and times are entered and displayed in JST.
- Administrators manage groups from Settings, where they can create groups, add members, and manage the daiko types shared by each group. Events are linked to a group. Each event queue lists goods requests first, then other requests, in submission order within each category. Finishing a request removes it from the active queue but keeps it in the user's request history. Member and daiko type names are saved with the request so subsequent edits do not change its history. Existing event groups are created automatically during migration; add members and daiko types to enable new member requests for them.
- Paste a TicketDive (`https://ticketdive.com/event/…`) or LivePocket (`https://livepocket.jp/e/…`, including `t.livepocket.jp`) event URL in **Add an event** to fetch its title and main visual automatically. Review the preview, edit the title if needed, then supply the group and date/time before saving. A failed fetch leaves manual entry available.
- Imported images are downloaded at their original resolution without recompression. TicketDive's Next.js thumbnail URL is unwrapped to its original image; LivePocket's direct event image is used. Files are stored in `DAIKO_EVENT_IMAGE_DIR` (default `./data/event-images`) and served to signed-in users. Identical image bytes share one stored file. Imports only populate the form; they do not create events until you select **Add event**.
- The administrator is configured separately with `DAIKO_ADMIN_EMAILS`; a ParcelHub administrator is not automatically a Daiko administrator.
- Settings are available to both users and administrators. Language supports English, Simplified Chinese, and Japanese; appearance offers Auto, Dark, Bright, and Pickles. Preferences are saved in the browser using ParcelHub's `parcelhub.language` cookie and `parcelhub.appearance` local storage key. Appearance and host-scoped cookies are separate between production Daiko and ParcelHub. Browser storage is also origin-specific on local development ports 5173 and 5174; the language cookie is shared on the same hostname. ParcelHub's French and German language selections fall back to English in Daiko without changing the saved cookie.
- Administrators can delete an event after confirmation, which also deletes its associated requests. Event editing is not yet available. Request attachments support JPEG, PNG, WebP, and GIF images up to 5 MiB.

Importing requires a publicly accessible event page and image. Fetches are limited to supported provider URLs and their event-image locations, with a 60-second deadline, a 5 MiB page limit and a 50 MiB original image limit. Unavailable pages, changed markup and provider access challenges are reported in the form. Imported files are retained even when a draft is canceled, so retrying or abandoning a draft never removes an image used by another event.

## Local development

Install dependencies with `npm ci` in this directory and in `client/`. Copy `.env.example` to `.env`, set `DAIKO_ADMIN_EMAILS` to the email of an existing local ParcelHub account, and configure any other settings as needed. With the default database path, create the file if needed using `test -f prisma/daiko.db || touch prisma/daiko.db`. Apply migrations with `npx prisma migrate deploy`, then start the API with `node --env-file=.env node_modules/tsx/dist/cli.mjs watch src/index.ts`. In a second terminal run `npm --prefix client run dev` and open http://localhost:5174/.

Start the local ParcelHub service on port 3001 and add `http://localhost:5174` to its `BETTER_AUTH_TRUSTED_ORIGINS`, preserving any existing origins. The Vite proxy reads `PARCELHUB_URL` from Daiko's root `.env` so that sign-in and API session checks use the same ParcelHub instance. Production uses the same accounts with a separate browser session on `daiko.nekoj.in`.

Run `npm test` for backend tests and `npm --prefix client run build` for the frontend build.

The Settings page displays the release build number from `client/build.json`. To prepare the next release, run `npm run release:prepare` from this checkout. The command fetches GitHub's `origin/main` and increments the build number stored there; it requires local `main` to match the fetched commit and the build file to have no uncommitted changes. Other uncommitted changes can be included in the release. Commit and push the updated build file with the release changes. If another release reaches GitHub first, update your branch and prepare the number again before pushing. The command does not commit, push, or deploy, and ordinary local or Docker builds do not change the number, so rebuilding the same release preserves it.

## Homelab deployment

For the production `daiko.nekoj.in` service and its existing data volume, follow [deployment notes](deploy/STAGING.md). The `compose.homelab.yml` configuration below describes the older separate ParcelHub-hosted instance; do not use its volume or Compose project as the production dataset.

`compose.homelab.yml` runs separate Daiko API and web containers on ParcelHub's existing Docker network. Set `DAIKO_ADMIN_EMAILS` in a private `.env` and keep the SQLite `daiko-data` volume; never run `down -v` as part of an update. `deploy/parcelhub-nginx.conf` adds Daiko routes to the ParcelHub configuration. `deploy/parcelhub-override.yml` mounts it into ParcelHub's client container without changing its source checkout. The ParcelHub client must be recreated with both its original compose file and this override. Existing `/api/` and `/` routes are preserved, while `/daiko/` and `/daiko-api/` go to Daiko. The homelab build sets `VITE_BASE_PATH=/daiko/` to keep this shared-origin route working; the dedicated-host build defaults to `/`. If ParcelHub's Nginx configuration changes later, merge those changes into the Daiko override before recreating its client.

The Daiko API checks both the ParcelHub session and a guarded ParcelHub endpoint on each authenticated request, so disabled accounts are rejected. ParcelHub and Daiko must remain on the same trusted Docker network; do not publish the Daiko API directly. Back up Daiko's SQLite volume separately from ParcelHub before upgrades.

### Legacy instance backups and rollback

With commands run on the host from `/root/Daiko`, stop the API before backing up its data volume so the snapshot includes a consistent SQLite state and all imported images. Both Compose configurations store images under `/app/data/event-images` in their existing persistent volume. The web container may remain running; requests fail temporarily while the API is stopped. Do not delete the volume.

```sh
mkdir -p backups
chmod 700 backups
docker compose -f compose.homelab.yml stop api
docker run --rm -v daiko_daiko-data:/source:ro -v "$PWD/backups:/backup" alpine:3.20 sh -c 'tar -czf /backup/daiko-$(date +%Y%m%d-%H%M%S).tar.gz -C /source .'
docker compose -f compose.homelab.yml up -d api
```

Copy the backup to separate storage. To remove only the routing integration, recreate ParcelHub's client using its original Compose file without the Daiko override. Daiko's containers and data volume remain intact. For normal ParcelHub updates, include `-f /root/Daiko/deploy/parcelhub-override.yml` after the original Compose file when recreating the client; otherwise the Daiko routes will disappear. Check `nginx -t` and both applications after changes.

Request image uploads are stored in `DAIKO_REQUEST_IMAGE_DIR` (default `data/request-images`). Back up this directory together with the database and event images; the Docker Compose configurations keep both image directories on the persistent data volume. Uploaded images are accessible only to their owner and administrators.
