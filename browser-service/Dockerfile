# Use the tested browser revision and its matching Node binary, but do not ship
# the full upstream image (other browser engines, package manager and caches).
FROM mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579 AS assets
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && mkdir /headless \
    && cp -a /ms-playwright/chromium_headless_shell-* /headless/ \
    && chmod -R go-w /headless/ \
    && cp "$(command -v node)" /build/node

FROM ubuntu:24.04@sha256:9c7f200c07e3d4a03e7249d2c16bf66a51120fb876aa2242cf31451412543289
# Playwright's Noble Chromium runtime libraries, TLS trust and Japanese fonts.
# Headless imports do not require Xvfb, WebKit's media stack, or video recording.
# Builders may use a nearby Ubuntu archive mirror; apt still verifies its signatures.
ARG UBUNTU_ARCHIVE_MIRROR
RUN if [ -n "$UBUNTU_ARCHIVE_MIRROR" ]; then \
      sed -i -E "s#http://(archive|security)\.ubuntu\.com/ubuntu/?#${UBUNTU_ARCHIVE_MIRROR%/}/#g" /etc/apt/sources.list.d/ubuntu.sources; \
    fi \
    && apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates fonts-ipafont-gothic fonts-liberation libatomic1 libstdc++6 \
      libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 \
      libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 \
      libnspr4 libnss3 libpango-1.0-0 libudev1 libx11-6 libxcb1 libxcomposite1 \
      libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1001 --shell /usr/sbin/nologin pwuser
WORKDIR /app
COPY --from=assets /build/node /usr/local/bin/node
COPY --from=assets /headless/ /ms-playwright/
COPY --from=assets /build/node_modules/ ./node_modules/
COPY *.mjs ./
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright NODE_ENV=production NODE_OPTIONS=--max-old-space-size=320
USER pwuser
CMD ["node", "server.mjs"]
