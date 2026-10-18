# syntax=docker/dockerfile:1.7
FROM node:22.12-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace apps/api --include-workspace-root=false
COPY apps/api apps/api
RUN npm run build -w apps/api && npm prune --omit=dev --workspace apps/api

FROM node:22.12-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app && mkdir -p /data/storage && chown app:app /data/storage
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/package.json ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
