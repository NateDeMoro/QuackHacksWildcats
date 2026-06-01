# Cloud Run container for @quack/api. Built from the monorepo root:
#   docker build -f apps/api/Dockerfile -t quack-api .
FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @quack/api build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared ./packages/shared
COPY apps/api/package.json ./apps/api/package.json
# Ship the email allowlist when present in the build context. The gitignored real file
# (allowlist.json) is what enforces access; the committed example always matches the glob so the
# COPY never fails when the real file is absent. The loader reads ./allowlist.json from the workdir.
# NOTE: `gcloud builds submit` derives context ignores from .gitignore, so allowlist.json is excluded
# there by default — add a .gcloudignore (or use Secret Manager) to ship it to Cloud Run.
COPY apps/api/allowlist*.json ./
COPY --from=build /app/apps/api/dist ./apps/api/dist
RUN pnpm install --prod --frozen-lockfile=false
EXPOSE 8080
CMD ["node", "apps/api/dist/server.js"]
