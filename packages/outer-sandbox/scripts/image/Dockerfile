# Wayfind computer golden image: slim Node + compiled agent server.
# Workspace and secrets are injected per-VM at /run (Phase 2) — the image
# itself carries code + catalog only, never keys.
FROM node:24-alpine

WORKDIR /srv/computer

COPY package.json ./
COPY node_modules ./node_modules
COPY dist ./dist
COPY workspace ./workspace

ENV PORT=8080
ENV WORKSPACE_DIR=/srv/computer/workspace

EXPOSE 8080

# Phase-1 scaffolding: without keys (injected at /run in Phase 2) the server
# exits via requireApiKey — stay alive so the build can snapshot. Phase 2
# replaces this with a proper /run init gate.
CMD ["sh", "-c", "node dist/server.js || (echo '[computer-image] server needs keys via /run (Phase 2)'; sleep 3600)"]
