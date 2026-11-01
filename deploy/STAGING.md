# Daiko staging

This configuration runs Daiko on `127.0.0.1:3334` for a Cloudflare Tunnel route at `daiko.nekoj.in`. It stores staging data in its own Docker volume, separate from production Daiko. The root URL redirects to `/daiko/`.

ParcelHub remains the identity provider. Staging accepts the same account credentials, but ParcelHub's host-only session cookie is not shared between the hostnames, so users must sign in separately. Signup and password recovery remain on ParcelHub. The proxy checks the staging browser Origin before forwarding only sign-in and sign-out to ParcelHub.

Run from the project directory with `DAIKO_ADMIN_EMAILS` set in a private `.env` or the shell:

```sh
docker compose -f compose.staging.yml config --quiet
docker compose -f compose.staging.yml up -d --build
docker compose -f compose.staging.yml exec staging-web nginx -t
curl -i http://127.0.0.1:3334/
curl -i http://127.0.0.1:3334/daiko-api/session
```

Configure the tunnel as HTTP to `127.0.0.1:3334`; do not expose the backend port directly. Never use `down -v` on a staging environment whose data should be retained. Changing ParcelHub credentials or disabling a user also affects their staging access.


## Work-in-progress page

The staging hostname currently serves a single-line placeholder for every path.
The full application's previous Nginx configuration is preserved in
`staging-app-nginx.conf`. To restore it, copy that file's contents into
`staging-nginx.conf`, test the configuration with `nginx -t`, and reload Nginx.
The staging application's database remains in its separate Docker volume.
