FROM node:24-alpine
WORKDIR /app
ENV CI=true
RUN corepack enable
RUN pnpm install -g
RUN pnpm add -g typescript
RUN pnpm install -g typescript
RUN npm install -g pnpm
