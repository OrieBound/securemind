# On-prem Docker (Docker-only install)

Run SecureMind with **Docker as the only host dependency** — Postgres (pgvector), Floci Cognito, Ollama, and the Next.js app in one Compose stack.

Cloud hosting uses `infra/` (Amplify + Lambda). This path is the **on-prem product** from the same repo.

---

## Quick start

```bash
git clone <repo-url> securemind
cd securemind
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
docker compose up --build
```

---

## What runs where

| Service | Image | Port |
|---------|-------|------|
| **app** | Built from repo `Dockerfile` | 3000 |
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
cp .env.onprem.example .env.local   # or merge Neon/Groq as needed
# point DATABASE_URL at localhost:5432, AWS_ENDPOINT_URL at localhost:4566
# Ollama in Compose publishes localhost:11434 — stop a host Ollama daemon if that port is taken
npm run dev
```

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

```bash
docker compose up -d db
npx prisma migrate deploy
docker compose up --build
```

Greenfield Compose `init` still uses `prisma db push` so an empty volume matches the current schema. Host-dev and existing volumes should use `migrate deploy`.

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

## Publishing (optional)

GitHub holds **source + Dockerfile + compose**. For pre-built app images, CI can push to GHCR on release; compose can reference `image: ghcr.io/…` instead of `build:`.

---

## Related

- [floci-local.md](./floci-local.md) — Floci feature matrix + host-dev checklist  
- [ADR 0006](../adr/0006-on-prem-docker.md) — decision record  
- [infra/README.md](../../infra/README.md) — AWS cloud path  
