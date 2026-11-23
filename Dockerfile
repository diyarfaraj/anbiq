# The Anbiq server. Build from the repository root: docker build -t anbiq .
FROM node:24-slim AS build
WORKDIR /src
RUN npm install --global pnpm@10.34.9
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm build \
 && pnpm --filter @anbiq/server deploy --prod --legacy /app

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080 \
    ANBIQ_CONFIG=/config/anbiq.yml \
    ANBIQ_DATA=/data/anbiq.db
WORKDIR /app
COPY --from=build /app .
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
