# Wayfind ONE outer golden image: slim Node + compiled team agent server.
# Workspace and secrets are injected per-VM at /hooks/run — the image
# itself carries code + catalog only, never keys.
FROM node:24-alpine

WORKDIR /srv/outer-sandbox

COPY package.json ./
COPY node_modules ./node_modules
COPY dist ./dist
COPY workspace ./workspace

ENV PORT=8080
ENV WORKSPACE_DIR=/srv/outer-sandbox/workspace

EXPOSE 8080

# Without keys (injected at /hooks/run) the server boots uninitialized and
# waits — stay alive so the build can snapshot.
CMD ["sh", "-c", "node dist/server.js || (echo '[outer-image] server exited; sleeping to hold the snapshot'; sleep 3600)"]
