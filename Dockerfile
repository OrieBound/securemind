# SecureMind on-prem application image (Next.js standalone).
# Infra (Postgres, Floci, Ollama) uses public images via docker-compose.yml.

# Node 22 LTS, pinned by digest. Update the digest deliberately (Dependabot proposes it).
FROM node:26-bookworm-slim@sha256:298992629d69bbd5b2b03ad57094d8e4fcb3a8eeb7c4e25d29de656519568913 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# The base image is pinned by digest; pull in Debian security fixes released since then.
RUN apt-get update   && apt-get upgrade -y --no-install-recommends   && rm -rf /var/lib/apt/lists/*

# ── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── Build ────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build
# Next's file tracing copies most of the repository into .next/standalone. The server runs the
# compiled code in .next/server, so remove sources, tests, fixtures (including the fake keys in
# the regression corpus) and tooling configs here, before the runner copies it: a file deleted in
# a later layer would still be inside the image.
RUN cd .next/standalone && rm -rf src scripts lambda tests docs infra   tsconfig.json tsconfig.tsbuildinfo vitest.config.mts eslint.config.mjs components.json amplify.yml   AGENTS.md CLAUDE.md

# ── One-shot bootstrap (schema, Floci Cognito; Ollama weights via ollama-init) ─
FROM base AS init
RUN apt-get update \
  && apt-get install -y --no-install-recommends awscli ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY scripts ./scripts
# Generate the client, then drop build-only tools (esbuild, test runners) from the shipped image.
RUN npx prisma generate && npm prune --omit=dev
CMD ["node", "scripts/docker/bootstrap.mjs"]

# ── Production app ─────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs \
  && mkdir -p /data /home/nextjs \
  && chown nextjs:nodejs /data /home/nextjs
ENV HOME=/home/nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

COPY scripts/docker/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

USER nextjs
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
