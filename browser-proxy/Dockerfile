FROM node:22-alpine3.24 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM alpine:3.24
RUN apk upgrade --no-cache && apk add --no-cache libstdc++ ca-certificates && addgroup -g 1000 app && adduser -D -u 1000 -G app app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json server.js ./
USER app
ENV NODE_ENV=production PORT=3128
EXPOSE 3128
CMD ["node", "server.js"]
