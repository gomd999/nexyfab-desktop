# syntax=docker/dockerfile:1.7

# The adapter image is intentionally unset. A reviewed private image must be
# supplied by immutable OCI digest and must provide Node >=22, sha256sum, and a
# native adapter at NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE.
ARG NEXYFAB_COMMERCIAL_NATIVE_ADAPTER_IMAGE
FROM ${NEXYFAB_COMMERCIAL_NATIVE_ADAPTER_IMAGE} AS worker

ARG NEXYFAB_COMMERCIAL_NATIVE_ADAPTER_IMAGE
ARG NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE=/opt/nexyfab/bin/native-adapter
ARG NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE_SHA256
ARG NEXYFAB_COMMERCIAL_WORKER_SOURCE_SHA256

USER root
RUN command -v node \
 && node -e "if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,511}@sha256:[a-f0-9]{64}$/.test(process.argv[1]))process.exit(1)" "$NEXYFAB_COMMERCIAL_NATIVE_ADAPTER_IMAGE" \
 && test -n "$NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE_SHA256" \
 && test -n "$NEXYFAB_COMMERCIAL_WORKER_SOURCE_SHA256" \
 && test -f "$NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE" \
 && test ! -L "$NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE" \
 && test -x "$NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE" \
 && echo "$NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE_SHA256  $NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE" | sha256sum --check --strict \
 && node -e "const major=Number(process.versions.node.split('.')[0]);if(major<22)process.exit(1)"

WORKDIR /app
COPY scripts/drawing-to-3d/commercial-precision-worker.mjs ./commercial-precision-worker.mjs
RUN echo "$NEXYFAB_COMMERCIAL_WORKER_SOURCE_SHA256  /app/commercial-precision-worker.mjs" | sha256sum --check --strict \
 && chmod 0555 /app/commercial-precision-worker.mjs

ENV NODE_ENV=production \
    NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE=$NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE \
    NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE_SHA256=$NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE_SHA256

USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "/app/commercial-precision-worker.mjs"]
