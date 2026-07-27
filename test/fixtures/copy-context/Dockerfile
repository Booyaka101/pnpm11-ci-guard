FROM node:24-alpine
WORKDIR /app
COPY . .
RUN pnpm i --frozen-lockfile
CMD ["node", "index.js"]
