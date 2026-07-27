FROM node:24-alpine
WORKDIR /app
ENV CI=true
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm rebuild
RUN pnpm --filter web rebuild
RUN pnpm run rebuild
RUN pnpm run clean
