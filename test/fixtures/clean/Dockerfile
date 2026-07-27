FROM node:24-alpine
WORKDIR /app
ENV pnpm_config_prefer_offline=true
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
CMD ["node", "index.js"]
