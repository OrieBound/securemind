# SecureMind

A privacy-aware AI workspace for models, Knowledge, memory, cost, and sensitive-data risk.

Detection runs before chat is sent and again when Knowledge is ingested. That reduces exposure. It does not guarantee complete removal of sensitive data, and it is not a compliance program. You review what is sent and what you store.

Two ways to run it:

- **On this computer.** Docker Compose. Postgres, local sign-in, and Ollama come up together. Chat uses the models Compose installs. Cloud model APIs and Bedrock are optional.
- **In your AWS account.** You clone this repo and apply Terraform there. The hosted install has no model until you enable Bedrock or save a vendor key. This repository’s GitHub Actions pipeline deploys the maintainer’s sandbox. It does not deploy into your account.

![SecureMind on-prem](docs/diagrams/securemind-onprem-diagram.jpg)

![SecureMind on AWS](docs/diagrams/securemind-aws-diagram.jpg)

Editable sources: [`docs/diagrams/securemind-onprem.drawio`](docs/diagrams/securemind-onprem.drawio) and [`docs/diagrams/securemind-aws.drawio`](docs/diagrams/securemind-aws.drawio). Longer write-ups: [Feature Guide](docs/SecureMind-Feature-Guide.docx) and [Technical Guide](docs/SecureMind-Technical-Guide.docx).

## On this computer

Install [Docker](https://docs.docker.com/get-docker/). That is the only host requirement.

```bash
git clone https://github.com/OrieBound/securemind.git
cd securemind
docker compose -f docker-compose.yml -f docker-compose.pull.yml pull
docker compose -f docker-compose.yml -f docker-compose.pull.yml up --no-build
```

Open http://localhost:3000 and create the first owner with an email and password you choose. There is no demo account.

The first start downloads `llama3.2:3b` for chat and `nomic-embed-text` for embeddings. That can take a while. Later starts reuse those models.

To build the app image yourself instead of pulling it:

```bash
docker compose up --build
```

Details, tear-down, and optional keys: [docs/deploy/on-prem-docker.md](docs/deploy/on-prem-docker.md).

## In your AWS account

Cloud is not a container to pull. Clone this repo, create the state bucket and GitHub OIDC role in **your** account, and connect Amplify to **your** copy of the repo.

```bash
git clone https://github.com/OrieBound/securemind.git
cd securemind
```

Follow [infra/README.md](infra/README.md). You choose the AWS profile, the environment name, and the GitHub environment variables. Do not reuse someone else’s state bucket or role.

After the first apply the user pool is empty. The setup code from Terraform is not the password. You choose the email and password on the site.

## Models

| Where | What runs with nothing else configured |
|---|---|
| Docker Compose | Ollama (`llama3.2:3b` chat, `nomic-embed-text` embeddings) |
| Your AWS account | No model, until Bedrock is enabled for that account or an admin saves a vendor key |

Groq, Gemini, OpenAI, Anthropic, and Grok run only after a key is saved. Bedrock runs only when that account is allowed to invoke it. A saved key is not selected for you.

## Contributing on the host

Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local
docker compose up -d db floci ollama ollama-init
npx prisma migrate deploy
npm run dev
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (port 3000) |
| `npm test` | Vitest |
| `npm run docker:onprem` | Full Compose stack, built from this repo |
| `npm run infra:up` | Apply Terraform in the account your `.env.deploy` profile points at |

## What to expect

- Detection is pattern-based and can miss values. There is no path that restores a replaced value.
- One operator directory. It is not multi-tenant hosting.
- Citations come from Knowledge you ingested. Conversation history is not a source.
- The hosted data store is DynamoDB. Local Docker uses Postgres with pgvector.
