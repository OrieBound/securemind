# On-prem Docker (Docker-only install)

Run SecureMind with **Docker as the only host dependency** — Postgres (pgvector), Floci Cognito, Ollama, and the Next.js app in one Compose stack.

Cloud hosting uses `infra/` (Amplify + Lambda). This path is the **on-prem product** from the same repo.

---

## Prerequisites

- [Git](https://git-scm.com/downloads)
- [Docker](https://docs.docker.com/get-docker/) with Compose v2 (`docker compose`, with a space)
- About 8 GB of free disk for images plus `llama3.2:3b` and `nomic-embed-text`
- 8 GB of RAM is a practical floor for the 3B chat model
- Free ports: `3000`, `5432`, `4566`, `11434`

No AWS account is needed. A model API key is not required, but it is strongly recommended: the built-in local models run on your own computer and, unless it is very powerful, they are slow and will not do well. Groq has a free tier and is a good first key. Node.js is only for the host-dev workflow later on this page.

## Quick start

Pull the published app image:

```bash
git clone https://github.com/OrieBound/securemind.git
cd securemind
docker compose -f docker-compose.yml -f docker-compose.pull.yml pull
docker compose -f docker-compose.yml -f docker-compose.pull.yml up --no-build
```

Or build from this repo:

```bash
docker compose up --build
```

First boot takes longer while Compose downloads default Ollama weights and `init` runs:

1. `ollama-init` pulls `nomic-embed-text` (Knowledge embeddings) and `llama3.2:3b` (local chat)  
2. Postgres schema (`prisma db push` + pgvector column)  
3. Floci Cognito pool (empty — first visitor becomes Owner)  

Open **http://localhost:3000** and create the first Owner (your email and a password you choose). There is no demo account. If you already ran an older Compose stack that seeded `admin@example.test`, `docker compose down -v` and bring it up again for an empty directory.

Optional Groq (faster chat / vision):

```bash
cp .env.onprem.example .env.onprem
# edit GROQ_API_KEY=…
docker compose -f docker-compose.yml -f docker-compose.pull.yml up --no-build
```

---

## What runs where

| Service | Image | Port |
|---------|-------|------|
| **app** | `ghcr.io/oriebound/securemind` or built from the repo `Dockerfile` | 3000 |
| **db** | `pgvector/pgvector:pg16` | 5432 |
| **floci** | `floci/floci:latest` | 4566 |
| **ollama** | `ollama/ollama:latest` | 11434 |
| **ollama-init** | Same image; one-shot `ollama pull` of default chat + embed models | — |
| **init** | One-shot bootstrap (same Dockerfile, `init` target) | — |

Internal DNS: app → `db`, `floci`, `ollama` by service name. No Node.js on the host.

---

## Developer workflow (you)

**Fast iteration** — infra in Docker, app on host:

```bash
docker compose up -d db floci ollama ollama-init
cp .env.example .env.local
# point DATABASE_URL at localhost:5432 and AWS_ENDPOINT_URL at localhost:4566
# Ollama in Compose publishes localhost:11434 — stop a host Ollama daemon if that port is taken
npm run dev
```

Host dev needs [Node.js 20](https://nodejs.org/) or newer and `npm install`. An optional Groq key goes in `.env.local` or in `.env.onprem` when the app itself runs in Compose.

**Validate the shipping path** before release:

```bash
docker compose up --build
```

---

## Backup

Postgres named volume `securemind-pgdata` holds chat, Knowledge text, facts, and encrypted vendor-key ciphertext. Original uploads live in `securemind-data`.

```bash
# Logical dump (no vector column bloat — embeddings can be rebuilt by Reprocess)
npm run backup:onprem

# Or pg_dump against the Compose database
docker compose exec db pg_dump -U securemind -d securemind -Fc -f /tmp/securemind.dump
docker compose cp db:/tmp/securemind.dump ./backups/securemind.dump
```

Restore into a running `db` service only. Encrypted keys in `InstanceConfig` need the same `INSTANCE_ENCRYPTION_KEY` / `INSTANCE_KEY_FILE` to decrypt.

## Migrations / upgrades

For an existing running Docker stack, rebuild both the initializer and app. Updating only the app can leave the database missing fields required by the newer code.

```bash
docker compose up --build --no-deps --exit-code-from init init
docker compose up -d --build --no-deps --wait app
```

Run the second command only after the initializer succeeds. The initializer synchronizes the schema without accepting data loss and does not run the demo seed. It reuses the existing database, accounts, uploads, and installed models. If Prisma reports a destructive change, resolve that schema change explicitly before proceeding.

Both Docker and `npm run dev` are local: they run on your computer. Docker includes the Ollama service and default models; a direct development server uses an already-running Ollama service, which can also be the one in Docker. Hosted installations require their own configured provider. The Models panel identifies the current runtime as **Local · Docker**, **Local · Running directly**, or **Hosted · Cloud**.

## Tear down

```bash
docker compose down       # keep volumes (data + uploads + models)
docker compose down -v    # DESTROYS Postgres, Floci, Ollama cache, uploads, encryption key
```

`down -v` is irreversible. Take a backup first.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `init` fails on Cognito | Ensure Floci is up: `docker compose ps`; re-run `docker compose up --build` |
| `init` slow | First boot downloads Ollama weights (`nomic-embed-text` + `llama3.2:3b`, GB-scale) — later boots skip if the volume already has them |
| Port 11434 in use | Host Ollama is already bound — stop it, or omit the Compose `ollama` port mapping and point `OLLAMA_BASE_URL` at the host daemon |
| Port 3000 in use | Stop host dev server or change app port mapping in compose |
| Fresh DB / migration errors | Init uses `db push` (not `migrate deploy`) on purpose for greenfield Compose volumes |
| Login 401 after `down -v` | Floci volume wiped — `init` reprovisions Cognito; wait for init to finish |

---

## Published image

GitHub Actions publishes the app when `main` changes the image inputs:

- `ghcr.io/oriebound/securemind:latest` — the app
- `ghcr.io/oriebound/securemind:init` — first-boot schema and local sign-in

`docker-compose.pull.yml` uses those tags. `docker compose up --build` builds from this repo instead. Postgres, Floci, and Ollama stay on their own public images.

---

## Related

- [floci-local.md](./floci-local.md) — Floci feature matrix + host-dev checklist  
- [ADR 0006](../adr/0006-on-prem-docker.md) — decision record  
- [infra/README.md](../../infra/README.md) — AWS cloud path  
