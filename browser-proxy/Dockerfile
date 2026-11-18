FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.js ./
USER node
ENV NODE_ENV=production PORT=3128
EXPOSE 3128
CMD ["node", "server.js"]
