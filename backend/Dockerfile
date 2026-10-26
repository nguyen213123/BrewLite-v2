FROM node:24-bookworm-slim AS base
RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources \
    && echo 'Acquire::https::Verify-Peer "false";' > /etc/apt/apt.conf.d/99noverify \
    && apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -f /etc/apt/apt.conf.d/99noverify \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3001
CMD ["sh", "-c", "npm run prisma:deploy && npm start"]
