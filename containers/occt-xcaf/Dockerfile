FROM debian:bookworm-slim AS occt-build
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates cmake g++ make libssl-dev \
     libocct-foundation-dev libocct-modeling-data-dev libocct-modeling-algorithms-dev \
     libocct-data-exchange-dev libocct-ocaf-dev libocct-visualization-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY native ./native
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
  && cmake --build build --parallel "$(nproc)" \
  && cmake --install build --prefix /opt/occt-xcaf

FROM node:22-bookworm-slim AS node-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY containers/occt-xcaf/src ./src
RUN ./node_modules/.bin/esbuild src/server.ts --bundle --packages=external --platform=node --format=esm --target=node22 --outfile=/out/server.mjs

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    OCCT_XCAF_NATIVE_BIN=/opt/occt-xcaf/bin/occt-xcaf-inspect \
    PORT=8080
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     libssl3 libocct-data-exchange-7.6 libocct-ocaf-7.6 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=node-build /out/server.mjs ./server.mjs
COPY --from=occt-build /opt/occt-xcaf /opt/occt-xcaf
RUN useradd --system --uid 10001 --create-home appuser
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
