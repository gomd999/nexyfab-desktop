FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    OPENSCAD_BIN=/usr/bin/openscad \
    OPENSCADPATH=/opt/openscad-libs \
    OPENSCAD_WORKER_ISOLATED=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends openscad git ca-certificates fonts-dejavu-core \
 && git clone --depth 1 https://github.com/BelfrySCAD/BOSL2.git /opt/openscad-libs/BOSL2 \
 && apt-get purge -y --auto-remove git \
 && rm -rf /var/lib/apt/lists/* \
 && command -v openscad

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.mjs ./server.mjs

USER node
CMD ["node", "server.mjs"]
