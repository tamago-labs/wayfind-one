# Wayfind exec golden image: slim Node + compiled exec agent.
# The image carries code only — never keys, never provider credentials.
# A per-session bearer is injected at /run; the workspace is pushed per
# session via POST /sync/in (nothing persists unless exported).
FROM node:24-alpine

WORKDIR /srv/exec

COPY package.json ./
COPY node_modules ./node_modules
COPY dist ./dist

ENV PORT=8080
ENV WORKSPACE_DIR=/srv/exec/workspace

EXPOSE 8080

CMD ["node", "dist/server.js"]
