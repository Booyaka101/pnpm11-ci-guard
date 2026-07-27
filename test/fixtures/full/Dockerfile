FROM node:24-alpine
WORKDIR /app
ENV npm_config_prefer_offline=true
ARG npm_config_//registry.npmjs.org/:_authToken
ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
ENV UNRELATED=1
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
CMD ["node", "index.js"]
