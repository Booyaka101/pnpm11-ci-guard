FROM node:24-alpine
WORKDIR /app
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
RUN pnpm install --resolution-only
CMD ["node", "index.js"]
