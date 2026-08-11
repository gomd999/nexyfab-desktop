FROM debian:bookworm-slim AS radiance-builder

ARG RADIANCE_SOURCE_URL=https://radsite.lbl.gov/radiance/dist/rad6R0P1.tar.gz
ARG RADIANCE_SOURCE_SHA256=b720d39e43fcf2ea09ab1699b62418836dfad8316743727761d29e85f82585cf
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl cmake build-essential \
      libgl1-mesa-dev libglu1-mesa-dev libx11-dev libxext-dev \
 && rm -rf /var/lib/apt/lists/* \
 && curl --fail --location --proto '=https' --tlsv1.2 \
      "$RADIANCE_SOURCE_URL" --output /tmp/radiance.tar.gz \
 && echo "$RADIANCE_SOURCE_SHA256  /tmp/radiance.tar.gz" | sha256sum --check --strict \
 && mkdir -p /src /build /opt/radiance \
 && tar -xzf /tmp/radiance.tar.gz -C /src \
 && cmake -S /src/ray -B /build \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/radiance \
      -DBUILD_HEADLESS=ON \
      -DBUILD_QT=OFF \
      -DBUILD_LIBTIFF=OFF \
      -DBUILD_TESTING=OFF \
 && cmake --build /build --parallel "$(nproc)" \
 && cmake --install /build \
 && for tool in oconv rtrace rfluxmtx gendaymtx dctimestep rmtxop; do \
      test -x "/opt/radiance/bin/$tool" || exit 1; \
    done \
 && rm -rf /tmp/radiance.tar.gz /src /build

FROM node:22-bookworm-slim AS cad-runtime-base

ARG BOSL2_COMMIT=92d697c2856de2fed93a33e858068589cefc2898
ARG NEXYFAB_WORKER_BUILD_ID
ENV NODE_ENV=production \
    NEXYFAB_WORKER_BUILD_ID=$NEXYFAB_WORKER_BUILD_ID \
    OPENSCAD_BIN=/usr/bin/openscad \
    OPENSCADPATH=/opt/openscad-libs \
    OPENSCAD_WORKER_ISOLATED=1 \
    CAD_RUNTIME_WORKER_ISOLATED=1 \
    GMSH_BIN=/usr/bin/gmsh \
    RAYPATH=.:/opt/radiance/lib

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openscad gmsh git ca-certificates fonts-dejavu-core \
      libglu1-mesa libgl1 libgomp1 \
 && git init /opt/openscad-libs/BOSL2 \
 && git -C /opt/openscad-libs/BOSL2 remote add origin https://github.com/BelfrySCAD/BOSL2.git \
 && git -C /opt/openscad-libs/BOSL2 fetch --depth 1 origin "$BOSL2_COMMIT" \
 && git -C /opt/openscad-libs/BOSL2 checkout --detach FETCH_HEAD \
 && test "$(git -C /opt/openscad-libs/BOSL2 rev-parse HEAD)" = "$BOSL2_COMMIT" \
 && rm -rf /opt/openscad-libs/BOSL2/.git \
 && apt-get purge -y --auto-remove git \
 && rm -rf /var/lib/apt/lists/* \
 && command -v openscad \
 && command -v gmsh \
 && gmsh --version

COPY --from=radiance-builder /opt/radiance /opt/radiance

FROM cad-runtime-base AS worker

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.mjs ./server.mjs

USER node
CMD ["node", "server.mjs"]
