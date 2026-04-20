# Enable BuildKit syntax for advanced caching
# syntax=docker/dockerfile:1

FROM node:trixie

ARG N8N_VERSION=2.16.1

# 1. Optimize APT caching
# We use a cache mount for apt to avoid re-downloading packages
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y \
    graphicsmagick tzdata git tini python3 python3-setuptools build-essential curl docker \
    && rm -rf /var/lib/apt/lists/*

# 2. Compile su-exec (Keep this logic but wrap it to stay clean)
RUN set -ex; \
    curl -o /usr/local/bin/su-exec.c https://raw.githubusercontent.com/ncopa/su-exec/master/su-exec.c; \
    apt-get update && apt-get install -y --no-install-recommends gcc libc-dev; \
    gcc -Wall /usr/local/bin/su-exec.c -o /usr/local/bin/su-exec; \
    chown root:root /usr/local/bin/su-exec; \
    chmod 0755 /usr/local/bin/su-exec; \
    rm /usr/local/bin/su-exec.c; \
    rm -rf /var/lib/apt/lists/*

# 3. Cache Global npm installs
# Using a cache mount for the npm registry significantly speeds up re-builds
RUN --mount=type=cache,target=/root/.npm \
    npm install -g "n8n@${N8N_VERSION}"

WORKDIR /work

# 4. THE MOST IMPORTANT STEP: Layered Copying
# Only copy package files first. This ensures 'npm install' only runs 
# if your dependencies actually changed.
COPY package.json package-lock.json ./

# Use npm cache mount for local dependencies
RUN --mount=type=cache,target=/root/.npm \
    npm install

# 5. Copy the rest of the source code AFTER dependencies are installed
COPY . .

ENV N8N_CUSTOM_EXTENSIONS=/work/dist

# Run build steps
RUN npm run install-global 
RUN npm run build

RUN mkdir -p /data && useradd -ms /bin/bash debian && chown debian:debian /data
RUN chown -R debian:debian /work

USER debian
CMD ["n8n", "start"]