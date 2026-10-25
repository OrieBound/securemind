# On-prem Docker (Docker-only install)

Run SecureMind with **Docker as the only host dependency** — Postgres (pgvector), Floci Cognito, Ollama, and the Next.js app in one Compose stack.

Cloud hosting uses `infra/` (Amplify + Lambda). This path is the **on-prem product** from the same repo.

---

## Prerequisites

- [Git](https://git-scm.com/downloads)
- [Docker](https://docs.docker.com/get-docker/) with Compose v2 (`docker compose`, with a space)
- About 8 GB of free disk for images plus `llama3.2:3b` and `nomic-embed-text`
- 8 GB of RAM is a practical floor for the 3B chat model
- Free port: `3000` (bound to this computer only; the database, sign-in service and Ollama are not published. Host development publishes them on loopback through `docker-compose.dev.yml`)

No AWS account is needed. A model API key is not required, but it is strongly recommended: the built-in local models run on your own computer and, unless it is very powerful, they are slow and will not do well. Groq has a free tier and is a good first key. Node.js is only for the host-dev workflow later on this page.

## Quick start

Build and start from this repository:

```bash
git clone https://github.com/OrieBound/securemind.git
cd securemind
docker compose up --build
```

The app and its first-boot initializer are built on your computer from the source you cloned, so what runs is exactly what you can read. Only the database, sign-in emulator and Ollama come from their own public images, pinned by digest.

First boot takes longer while Compose downloads default Ollama weights and `init` runs:

1. `ollama-init` pulls `nomic-embed-text` (Knowledge embeddings) and `llama3.2:3b` (local chat)  
2. Postgres schema (`prisma db push` + pgvector column)  
3. Floci Cognito pool (empty) and a one-time setup code for the first Owner  

Open **http://localhost:3000** and create the first Owner (your email, a password you choose, and the setup code). Show the setup code with `docker compose logs init | grep "setup code"`. There is no demo account. If you already ran an older Compose stack that seeded `admin@example.test`, `docker compose down -v` and bring it up again for an empty directory.

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
| **app** | Built from the repo `Dockerfile` | 3000 |
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
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db floci ollama ollama-init
cp .env.example .env.local
# point DATABASE_URL at localhost:5432 and AWS_ENDPOINT_URL at localhost:4566
# Ollama in Compose publishes localhost:11434 — stop a host Ollama daemon if that port is taken
npm run dev
```

Host dev needs [Node.js 22](https://nodejs.org/) or newer and `npm install`. An optional Groq key goes in `.env.local` or in `.env.onprem` when the app itself runs in Compose.

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

## Updating

Run `git pull`, then rebuild the initializer and the app as described in [Migrations / upgrades](#migrations--upgrades). Your volumes (database, uploads, models, sign-in directory) are kept.

To review a release before running it, check out a specific commit (`git checkout <commit>`) instead of following `main`.

---

## Related

- [Older Floci lab notes](../archive/floci-local.md) — historical, kept for reference  
- [ADR 0006](../adr/0006-on-prem-docker.md) — decision record  
- [infra/README.md](../../infra/README.md) — AWS cloud path  

---

## Network exposure and security defaults

- Only the app is published, on `127.0.0.1:3000`. Postgres, the Floci sign-in service and Ollama are reachable only inside the Compose network.
- To reach the app from other computers, use the HTTPS front end instead of opening port 3000:

  ```bash
  echo SECUREMIND_DOMAIN=securemind.example.org >> .env
  docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d
  ```

  Caddy gets a certificate automatically (needs public DNS and ports 80/443). On a LAN with no public name, also set `SECUREMIND_TLS=internal` and trust Caddy's local authority in each browser. The app turns on HSTS when served this way. Without HTTPS, passwords and documents cross the network in clear text.
- Containers run with `no-new-privileges`, process and memory limits and rotated logs. The app runs as a non-root user with no Linux capabilities and a read-only filesystem apart from `/data` and scratch paths. Images are pinned by digest; update them deliberately.
- Optionally set `POSTGRES_PASSWORD` in a `.env` file before the first start. It cannot be changed afterwards without altering the database user.
- Bedrock through your AWS profile is opt-in (`docker-compose.bedrock.yml`) and mounts only a folder you choose (`./aws-profile`), never your whole `~/.aws`. To share one profile: run `aws sso login --profile <name>`, then `npm run bedrock:profile -- <name>` (it copies only that profile, its sso-session and its current sign-in token, and refuses profiles that use access keys), then `docker compose -f docker-compose.yml -f docker-compose.bedrock.yml up -d`. When the AWS sign-in expires, repeat the first two commands; no restart is needed. Everything in that folder is readable by the app, so share a profile with only the access you want the app to have.
- Bedrock from Docker, two ways to share the access. **Single sign-on** (the commands above) expires with your AWS sign-in, usually after a few hours. **A Bedrock-only access key** does not expire, so it suits an app you leave running: in AWS, create an IAM user whose only permission is the Bedrock calls the app makes (`bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`, `bedrock:ListFoundationModels`, `bedrock:ListInferenceProfiles`, `bedrock:GetFoundationModel`, `bedrock:GetFoundationModelAvailability`), then put its key in `./aws-profile/credentials` as `[bedrock]` with `aws_access_key_id` and `aws_secret_access_key`, and `[profile bedrock]` with a `region` in `./aws-profile/config`. Start Docker with the Bedrock file and choose that profile. Never give the app an administrator profile if a narrower one will do, because everything in the folder is readable by the app. SecureMind never asks for AWS keys in its screens.
- **How to tell it is working:** Settings, Models, Amazon Bedrock shows Credentials as Found and the AWS account number once the profile is chosen. If it is not working, that same screen names the cause: no profile is shared yet, the chosen profile is not in the shared folder, or its sign-in has expired, and each message gives the next command.
- Team size: one install serves one organization; 1 to 25 people is recommended and it can serve up to about 100. Beyond a few people, run it on a server, add a model API key (the built-in local model serves only a few people at a time), and use the HTTPS front end. Docker is for a computer or a private network, not for the public internet. See `docs/security-audit/` for the assessment.
