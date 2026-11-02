# Pinpoint backend + web app
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY server/package.json server/
COPY web/package.json web/
COPY extension/package.json extension/
RUN npm ci
COPY . .
RUN npm run build -w web && npm run build -w server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public
COPY --from=build /app/server/package.json ./server/package.json
VOLUME /data
EXPOSE 8787
WORKDIR /app/server
CMD ["node", "dist/index.js"]
