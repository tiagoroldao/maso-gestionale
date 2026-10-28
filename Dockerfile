# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN node ace build

FROM base AS production
ENV NODE_ENV=production
# pg_dump for the nightly backups (#33), the same major version as the db
RUN apk add --no-cache postgresql17-client
COPY --from=build /app/build ./
RUN npm ci --omit=dev
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
EXPOSE 3333
ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "bin/server.js"]
