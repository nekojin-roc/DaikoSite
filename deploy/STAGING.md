# Production deployment (historical staging names)

`https://daiko.nekoj.in/` is the production Daiko site. Cloudflare Tunnel forwards HTTP to `127.0.0.1:3334`. This release serves the app at `/` and redirects old `/daiko/` links to the corresponding root paths. The Docker Compose project `daiko-staging`, services `staging-api` and `staging-web`, and volume `daiko-staging_staging-data` retain their historical names. Do not replace or recreate that volume: it contains the production database and uploaded images. The older Daiko instance under `parcelhub.nekoj.in/daiko/` uses a separate dataset and is not the production site.

ParcelHub is the identity provider. Daiko uses the same account credentials, with a separate host-scoped browser session. The proxy validates the Daiko browser origin before forwarding sign-in and sign-out to ParcelHub. Signup and password recovery remain on ParcelHub.

For an update, prepare a release directory with the intended source and a private `.env` containing `DAIKO_ADMIN_EMAILS`. `compose.staging.yml` is the production Compose file despite its historical name, and mounts `deploy/staging-app-nginx.conf` for the application. Validate configuration and build images before stopping any service:

```sh
docker compose -f compose.staging.yml config --quiet
docker compose -f compose.staging.yml build
```

Back up the entire production volume with the API stopped before applying migrations or replacing the service. Keep the web service running while the API is stopped, and copy backups to separate storage:

```sh
mkdir -p /root/Daiko-production-backups
chmod 700 /root/Daiko-production-backups
docker compose -f compose.staging.yml stop staging-api
docker run --rm -v daiko-staging_staging-data:/source:ro -v /root/Daiko-production-backups:/backup alpine:3.20 sh -c 'tar -czf /backup/daiko-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C /source .'
docker compose -f compose.staging.yml up -d --no-build
docker compose -f compose.staging.yml exec staging-web nginx -t
curl -f http://127.0.0.1:3334/daiko-api/session
```

If backup fails, restart the existing API container rather than applying the new release. Check the migration logs and public site after deployment. Never use `down -v` when updating this project. Changing ParcelHub credentials or disabling an account also affects production Daiko access.

To temporarily show a work-in-progress placeholder, change the web configuration mount to `staging-nginx.conf` and recreate the web container. The production database remains in its separate Docker volume.
