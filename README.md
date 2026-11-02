# SecureMind

A privacy-aware AI workspace for models, Knowledge, memory, cost, and sensitive-data risk.

## You run it, and you own it

SecureMind is free, open-source software that you run yourself. There is no paid or managed version. Copy the code from this repository and run it on your own computer with Docker, or in your own AWS account. The copy is yours: your data stays in your install, and you can change it or take it in a different direction under the license below.

The author also runs a private, invitation-only copy for friends and reviewers, and a [sample site](https://sample.securemind.chat) with made-up data that needs no account.

Detection runs before chat is sent and again when Knowledge is ingested. That reduces exposure. It does not guarantee complete removal of sensitive data, and it is not a compliance program. You review what is sent and what you store.

## Where to read

| You want | Start |
|---|---|
| On this computer | [On-prem](#on-prem) below, then [docs/deploy/on-prem-docker.md](docs/deploy/on-prem-docker.md) |
| Your own AWS account, from zero | [docs/deploy/aws-from-zero.md](docs/deploy/aws-from-zero.md) |
| Your own AWS account, condensed reference | [AWS](#aws) below, then [infra/README.md](infra/README.md) |
| Diagram sources | [on-prem](docs/diagrams/securemind-onprem.drawio) · [AWS](docs/diagrams/securemind-aws.drawio) |
| Longer write-ups | [Feature Guide](docs/SecureMind-Feature-Guide.docx) · [Technical Guide](docs/SecureMind-Technical-Guide.docx) |

## Models

| Where | What runs with nothing else configured |
|---|---|
| Docker Compose | Ollama (`llama3.2:3b` chat, `nomic-embed-text` embeddings) |
| Your AWS account | No model, until Bedrock is enabled for that account or an admin saves a vendor key |

Groq, Gemini, OpenAI, Anthropic, and Grok run only after a key is saved. Bedrock runs only when that account is allowed to invoke it. A saved key is not selected for you.

## What to expect

- Detection is pattern-based and can miss values. There is no path that restores a replaced value.
- One operator directory. It is not multi-tenant hosting.
- Two-step verification with an authenticator app is optional on the hosted edition and recommended for admins. The local Docker sign-in does not support it. See [docs/mfa.md](docs/mfa.md).
- Built and tested on a Windows computer with Chrome, Docker Desktop and an AWS account in us-east-1. Use it from a desktop browser. The layout fits phone and tablet widths, but macOS and Linux installs, Apple Silicon, other browsers and real phones have not been tested. Compose builds the image on your own machine, so it is not tied to one processor type.
- Citations come from Knowledge you ingested. Conversation history is not a source.
- The hosted data store is DynamoDB. Local Docker uses Postgres with pgvector.

## On-prem

<img src="docs/diagrams/securemind-onprem-diagram.jpg" alt="SecureMind on-prem" width="820">

Docker Compose on this computer. Postgres, local sign-in, and Ollama come up together. Chat uses the models Compose installs. Cloud model APIs and Bedrock are optional.

### Prerequisites

- [Git](https://git-scm.com/downloads)
- [Docker](https://docs.docker.com/get-docker/) with Compose v2. The command is `docker compose`, with a space.
- About 8 GB of free disk. The first start downloads container images plus `llama3.2:3b` and `nomic-embed-text`.
- Enough free memory for a 3B chat model. 8 GB of RAM on the machine is a practical floor.
- Port `3000` free. The database, local sign-in and Ollama stay inside Docker and publish no ports (the contributor setup below publishes them on localhost).

No AWS account is needed. A model API key is not required, but it is strongly recommended: the built-in local models use your own computer's resources and, unless it is very powerful, they are slow. Groq has a free tier and is a good first key. On AWS, use Bedrock or a key, since there is no local model.

### Who it is for

SecureMind is intended for small to mid-sized teams. One install serves one organization: **1 to 25 people is the recommended range**, and it can serve **up to about 100 people** with a few adjustments (an AWS concurrency limit, a realistic budget, and two-step verification for admins). Separate organizations should each run their own install. See [Operating an installation](docs/SecureMind-Technical-Guide.docx) in the technical guide and the [security assessment](docs/security-audit/).

### Run

```bash
git clone https://github.com/OrieBound/securemind.git
cd securemind
docker compose up --build
```

### Confirm

Open http://localhost:3000 and create the first owner with an email and password you choose. The first owner also needs the one-time setup code the install printed when it started; show it again with `docker compose logs init`. There is no demo account. The first start can sit on the model download for a while. Later starts reuse those models.

Docker builds the app from this repository on your computer; there is no image to download from the author.

### Stop

```bash
docker compose down       # keep your data and models
docker compose down -v    # deletes the database, uploads, and models
```

Ports, backups, and optional keys: [docs/deploy/on-prem-docker.md](docs/deploy/on-prem-docker.md).

## AWS

<img src="docs/diagrams/securemind-aws-diagram.jpg" alt="SecureMind on AWS" width="820">

You clone this repo and apply Terraform in an account you administer. The hosted install has no model until that account can call Bedrock, or you save a vendor key. The Terraform jobs in this repository's GitHub Actions workflow are off by default. If you want them for your own copy, turn them on with repository variables (see the guide below). Your install uses your own state bucket, role, and GitHub environment.

These resources can incur AWS charges. Remove them with `npm run infra:down -- --yes` when you are finished.

### Prerequisites

- An [AWS account](https://aws.amazon.com/) you administer. Keep the app out of an organization management account.
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) version 2, with a named profile (`aws configure` or IAM Identity Center).
- [Terraform 1.14](https://developer.hashicorp.com/terraform/install) or newer. State locking uses an S3 lock file.
- [Node.js 22](https://nodejs.org/) or newer. The apply scripts package the chat Lambda.
- [Git](https://git-scm.com/downloads)
- A GitHub repository you control, so you can connect the Amplify GitHub App to your copy.
- Permission in that account to create IAM, S3, Lambda, API Gateway, Cognito, Amplify, DynamoDB, Systems Manager Parameter Store, and CloudFormation.
- For a model with no vendor key: [Bedrock model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access-modify.html) for Titan Text Embeddings v2 and a chat model you will use. Access in the console is separate from IAM.

The example region is `us-east-1`.

### Run

```bash
git clone https://github.com/OrieBound/securemind.git
cd securemind
```

Make your own private repository from the code, then follow [docs/deploy/aws-from-zero.md](docs/deploy/aws-from-zero.md) (every step marked required or optional) or the condensed [infra/README.md](infra/README.md): bootstrap the state bucket and deploy role, connect Amplify, and apply. The GitHub variables are optional and only needed if you want GitHub Actions to run Terraform for you.

### Confirm

The user pool starts empty. Print the one-time setup code with `terraform -chdir=infra/terraform output -raw setup_claim_secret`, open your Amplify address, and enter the code with the email and password you choose. That account becomes the Owner. The code is not a password. A Docker install makes its own setup code on first start (see [Confirm](#confirm) above).

## Contributing on the host

Node.js 22 or newer.

```bash
npm install
cp .env.example .env.local
npm run docker:up                 # database, local sign-in and Ollama on localhost ports
npx prisma db push                # create the schema
npx prisma db execute --file scripts/add-vector-embedding.sql
npm run dev
```

Before a commit: `npx tsc --noEmit`, `npm run lint` and `npm test` (CI runs all three plus `npm run build`).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (port 3000) |
| `npm test` | Vitest |
| `npm run lint` | ESLint (CI fails on errors) |
| `npm run docker:onprem` | Full Compose stack, built from this repo |
| `npm run infra:up` | Apply Terraform in the account your `.env.deploy` profile points at |

## Contact

SecureMind is a personal project shared as is, with no support agreement. If you want to reach the author:

- Questions and ideas: open a [discussion](https://github.com/OrieBound/securemind/discussions) or an [issue](https://github.com/OrieBound/securemind/issues).
- Anything else: email [hello@securemind.chat](mailto:hello@securemind.chat), use the [Contact page](https://securemind.chat/contact/), or message the author on [LinkedIn](https://www.linkedin.com/in/orie-hulan).
- Security reports: follow [SECURITY.md](SECURITY.md). Please do not put details in a public issue or a public message.

## License

SecureMind is released under the [Apache License 2.0](LICENSE). You can use it, change it, and run your own version, including inside your company. It comes as is, with no warranty. Sanitization reduces risk. It does not guarantee that every sensitive value is removed, and it is not a compliance program.

### If you use or share it

The license asks for a few small things, and nothing else:

- Keep the [LICENSE](LICENSE) file with the code when you share it.
- Keep the [NOTICE](NOTICE) file, or its text, in anything you distribute. It names the original project and its source.
- If you changed files, say so in those files.
- Do not present your copy as the official SecureMind or use the project name or logo to suggest the author endorses it.

Running it for yourself, privately, asks nothing of you. You do not have to tell anyone.

### A friendly request

If you build on SecureMind, a line such as "Based on SecureMind (github.com/OrieBound/securemind)" in your README or about page is appreciated. A star on the repository, or a note in the [Who is using SecureMind?](https://github.com/OrieBound/securemind/discussions/1) thread, is also a welcome way to say you are using it. These are requests, not license conditions, and nobody is breaking any agreement by skipping them.

### Usage data

SecureMind does not report anything to the author. It has no tracking, no usage counter and no phone-home call, so there is no way for the author to know who runs it. The public counts are the ones GitHub shows: stars, forks and package downloads. The securemind.chat website and the sample site are separate from the software and use Google Analytics to count visits. See the website's privacy page.
