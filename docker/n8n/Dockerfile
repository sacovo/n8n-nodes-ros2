# Enable BuildKit syntax for advanced caching
# syntax=docker/dockerfile:1

ARG N8N_IMAGE=n8n-src-builder

# =========================================================
# Stage 1: Build n8n from source (default server-side build)
# =========================================================
FROM node:24-trixie AS n8n-src-builder
ARG N8N_REPO=https://github.com/sacovo/n8n.git
ARG N8N_BRANCH=7b266633ca6f0c74bb31e9ec8bb38743644873cd

RUN apt-get update && apt-get install -y git python3 build-essential && rm -rf /var/lib/apt/lists/*
RUN git clone ${N8N_REPO} /n8n-src && cd /n8n-src && git checkout ${N8N_BRANCH}

WORKDIR /n8n-src
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter=n8n --prod --legacy deploy --no-optional /usr/local/lib/node_modules/n8n

# =========================================================
# Stage 2: Load n8n from local filesystem context (dev fallback)
# =========================================================
FROM scratch AS n8n-local-context
COPY docker/n8n/n8n-compiled/ /usr/local/lib/node_modules/n8n/

# =========================================================
# Stage 3: Selector stage
# =========================================================
# Choose where to copy n8n from. Options:
# - n8n-src-builder (default: clone and compile from source)
# - n8n-local-context (copy local folder docker/n8n/n8n-compiled)
# - Any prebuilt docker image name (e.g. ghcr.io/sacovo/n8n:master)
ARG N8N_IMAGE
FROM ${N8N_IMAGE} AS n8n-provider

# =========================================================
# Stage 4: Main runtime stage
# =========================================================
FROM node:24-trixie

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  apt-get update && apt-get install -y \
  graphicsmagick tzdata git tini python3 python3-setuptools build-essential curl \
  && rm -rf /var/lib/apt/lists/*

RUN set -ex; \
  curl -o /usr/local/bin/su-exec.c https://raw.githubusercontent.com/ncopa/su-exec/master/su-exec.c; \
  apt-get update && apt-get install -y --no-install-recommends gcc libc-dev; \
  gcc -Wall /usr/local/bin/su-exec.c -o /usr/local/bin/su-exec; \
  chown root:root /usr/local/bin/su-exec; \
  chmod 0755 /usr/local/bin/su-exec; \
  rm /usr/local/bin/su-exec.c; \
  rm -rf /var/lib/apt/lists/*

# Copy the compiled n8n from our chosen provider stage
COPY --from=n8n-provider /usr/local/lib/node_modules/n8n /usr/local/lib/node_modules/n8n
RUN cd /usr/local/lib/node_modules/n8n && (npm rebuild sqlite3 isolated-vm || echo "Native rebuild failed/skipped, using pre-compiled binaries")
RUN ln -s /usr/local/lib/node_modules/n8n/bin/n8n /usr/local/bin/n8n

WORKDIR /work

# 4. Layered copying
COPY package.json package-lock.json ./

# Use npm cache mount for local dependencies
RUN --mount=type=cache,target=/root/.npm \
  npm install

# 5. Copy the rest of the source code AFTER dependencies are installed
COPY . .

# Run build steps
RUN npm run install-global 
RUN npm run build

RUN mkdir -p /data && useradd -ms /bin/bash debian && chown debian:debian /data
RUN chown -R debian:debian /work

# Copy the entrypoint script and make it executable
COPY docker/n8n/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Go back to /work to keep runtime working directory clean
WORKDIR /work

USER debian
ENTRYPOINT ["/entrypoint.sh"]
