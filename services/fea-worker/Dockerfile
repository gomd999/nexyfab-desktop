FROM node:22-bookworm-slim AS build

WORKDIR /src
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
COPY services/fea-worker ./services/fea-worker
RUN ./node_modules/.bin/esbuild services/fea-worker/server.ts --bundle --platform=node --format=esm --target=node22 --outfile=/out/server.mjs --external:ioredis \
 && ./node_modules/.bin/esbuild services/fea-worker/solver.ts --bundle --platform=node --format=esm --target=node22 --outfile=/out/solver.mjs --external:ioredis

FROM node:22-bookworm-slim AS worker

ENV NODE_ENV=production \
    CAD_RUNTIME_EXTERNAL_WORKER=1 \
    FEA_WORKER_CONCURRENCY=1 \
    FEA_WORKER_LEASE_MS=20000
WORKDIR /app
COPY services/fea-worker/package.json services/fea-worker/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /out/server.mjs /out/solver.mjs ./
COPY public/openscad ./public/openscad

USER node
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
