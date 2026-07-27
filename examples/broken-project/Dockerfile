FROM node:24-alpine AS builder

RUN corepack enable

WORKDIR /app

# These were tuned for npm/pnpm v10 CI throughput.
# pnpm v11 no longer reads npm_config_* at all, so both of these do nothing now.
ENV npm_config_prefer_offline=true
ENV npm_config_registry=https://registry.npmjs.org/
ARG npm_config_network_concurrency=8

# Still honoured by pnpm 11.6+ (URL-scoped registry auth), so this one is fine.
ARG npm_config_//registry.npmjs.org/:_authToken

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Meant to rebuild native modules against this image's toolchain.
# package.json also defines a "rebuild" script, so under v11 this runs that
# script instead — silently, with no error.
RUN pnpm rebuild

COPY . .
RUN pnpm run build

FROM node:24-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/server.js"]
