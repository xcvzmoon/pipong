ARG BUILD_IMAGE=node:24-bookworm-slim
FROM ${BUILD_IMAGE} AS workspace

FROM postgres:18-bookworm
RUN apt-get update && apt-get install --yes --no-install-recommends procps && rm -rf /var/lib/apt/lists/*
COPY --from=workspace /usr/local /usr/local
COPY --from=workspace --chown=postgres:postgres /workspace /workspace
COPY --chmod=0755 ops/qualification-container.sh /opt/pipong/qualification-container.sh
USER postgres
WORKDIR /workspace
EXPOSE 5432 3000 3001
ENTRYPOINT ["sh", "/opt/pipong/qualification-container.sh"]
