FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY scripts/server-runtime.mjs ./scripts/server-runtime.mjs
COPY dashboard ./dashboard
COPY runtime/benchmark-results.json runtime/sanitized-privacy-audit.jpg ./runtime/
ENV CAPTAIN_HOST=0.0.0.0 CAPTAIN_PORT=4317
EXPOSE 4317
CMD ["node", "server/index.mjs"]
