FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN npm install --global pnpm@12.6.0
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm build

FROM build AS migrate
LABEL org.opencontainers.image.source="https://github.com/xcvzmoon/pipong"
ENV NODE_ENV=production
USER node
WORKDIR /workspace/packages/database
CMD ["sh", "/workspace/ops/migrate.sh"]

FROM node:24-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/xcvzmoon/pipong"
ENV NODE_ENV=production
USER node
WORKDIR /app

FROM runtime AS server
COPY --from=build --chown=node:node /workspace/apps/server/.output /app/.output
COPY --from=build --chown=node:node /workspace/apps/worker/dist /app/operator
EXPOSE 3000
CMD ["node", "--env-file=/run/secrets/api.env", ".output/server/index.mjs"]

FROM runtime AS worker
COPY --from=build --chown=node:node /workspace/apps/worker/dist /app/dist
CMD ["node", "--env-file=/run/secrets/worker.env", "dist/index.mjs"]

FROM postgres:18-bookworm AS database
LABEL org.opencontainers.image.source="https://github.com/xcvzmoon/pipong"
COPY --chmod=0644 ops/postgres-entrypoint.sh /opt/pipong/postgres-entrypoint.sh
COPY --chmod=0644 ops/provision.sh /docker-entrypoint-initdb.d/10-pipong.sh
COPY --chmod=0644 packages/database/provision.sql /opt/pipong/provision.sql
RUN chmod 0755 /opt/pipong
ENTRYPOINT ["sh", "/opt/pipong/postgres-entrypoint.sh"]
