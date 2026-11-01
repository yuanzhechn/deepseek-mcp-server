FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN apk add --no-cache --virtual .native-build python3 make g++ \
    && npm ci \
    && apk del .native-build

FROM deps AS build

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

LABEL io.modelcontextprotocol.server.name="io.github.DMontgomery40/deepseek"
LABEL org.opencontainers.image.source="https://github.com/DMontgomery40/deepseek-mcp-server"

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN apk add --no-cache --virtual .native-build python3 make g++ \
    && npm ci --omit=dev \
    && apk del .native-build

# Keep policy and budget state across container restarts; mount this directory.
ENV DEEPSEEK_COLLAB_STATE_DIR=/var/lib/deepseek-mcp
VOLUME /var/lib/deepseek-mcp

COPY --from=build /app/build ./build

ENTRYPOINT ["node", "build/index.js"]
