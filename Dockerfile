FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/game-engine/package.json ./packages/game-engine/package.json
COPY apps/server/package.json ./apps/server/package.json
COPY apps/client/package.json ./apps/client/package.json
RUN npm ci

COPY tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm run build
RUN npm prune --omit=dev && npm cache clean --force

FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    CLIENT_DIST_DIR=/app/apps/client/dist

WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/game-engine/package.json ./packages/game-engine/package.json
COPY --from=build /app/packages/game-engine/dist ./packages/game-engine/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/client/dist ./apps/client/dist

USER node
EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
