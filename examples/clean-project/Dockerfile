FROM node:24-alpine AS builder

RUN corepack enable

WORKDIR /app

# pnpm v11 reads pnpm_config_* (npm_config_* is ignored since v11.0).
ENV pnpm_config_prefer_offline=true
ENV pnpm_config_registry=https://registry.npmjs.org/

# Non-interactive mode so pnpm follows allowBuilds instead of prompting and hanging.
ENV CI=true

# pnpm-workspace.yaml is a required config file in v11 — it must be in the image.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:24-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/server.js"]
