FROM node:22-alpine

ARG NEXYFAB_BUILD_ID=local

ENV HOST=0.0.0.0 \
    PORT=8080 \
    NEXYFAB_BUILD_ID=${NEXYFAB_BUILD_ID}

WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

USER node

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
