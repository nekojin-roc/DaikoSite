FROM mcr.microsoft.com/playwright:v1.65.1-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY *.mjs ./
ENV NODE_ENV=production NODE_OPTIONS=--max-old-space-size=320
USER pwuser
CMD ["node", "server.mjs"]
