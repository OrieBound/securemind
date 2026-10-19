# Security

SecureMind is a personal project shared as is. It reduces the risk of sending sensitive details to a model. It does not guarantee that every sensitive value is found, and it is not a compliance program. See the [license](LICENSE) for the terms.

## Reporting a problem

Please report a vulnerability privately, so it can be fixed before it is public:

1. Use **Security → Report a vulnerability** on this repository's GitHub page.
2. If that is not available, use the contact details on the [Contact page](https://securemind.chat/contact/) and say you have a security report. Please do not put details in a public issue.

Include what you found, the steps to reproduce it and the version or commit. The author reads reports and will try to answer, but there is no promised response time or support agreement.

## What is in scope

- The application code in this repository.
- The Terraform and scripts in `infra/`, including the IAM roles and policies they create.

Your own install is yours to run. A report about how an operator configured their own AWS account or Docker host is outside what can be fixed here.

## How the project is built to limit damage

- **Nothing is shared between installs.** There is no central service. Each install holds its own keys, data and users, and the author has no access to any of them.
- **The deploy role trusts one repository.** The role the setup creates for GitHub Actions can only be assumed by your repository, matched by its numeric IDs, running in one named GitHub environment. A copy of the code in another repository cannot use it. Its writes are limited to resources named for SecureMind, and it can only create roles that carry a permission boundary. It cannot edit itself.
- **No cloud credentials in the app or the repository.** An AWS access key is never accepted through the interface and never stored in the database. Vendor API keys are encrypted at rest, and the interface only shows the last four characters.
- **Sensitive values are replaced before they leave the browser.** There is no restore path. The original value is not saved or logged.
- **Sign-in is closed by default on the hosted edition.** Accounts are created by an admin, and the first account needs a one-time setup code.
- **The open API address is rate limited.** The chat endpoint checks the sign-in token itself, and the gateway caps request rates so a flood cannot run up a large bill.

## Keeping an install safe

- Keep the repository that deploys your AWS install **private**, with branch protection on `main`.
- Turn on **required reviewers** for the GitHub environment if your plan allows it. Otherwise restrict deployments to `main`.
- Set an **AWS Budget** alert, for example at $5 a month. Terraform creates one when you set `alert_email` (`monthly_budget_usd`, default 5).
- Never put an AWS access key in GitHub, and never paste an API key into a public issue.

## Known limits (read before deploying)

- **The Docker stack is single-user.** It publishes only the app, on `127.0.0.1`. For other computers, use the included HTTPS front end (`docker-compose.tls.yml`) and a firewall. See `docs/deploy/on-prem-docker.md`.
- **Admins can impersonate members.** An Admin can set a member's password, which gives access to that member's conversations and documents.
- **Chat redaction runs in the browser.** The server also replaces SSNs, SINs, card numbers and secrets in any chat request, even one that skips the browser. Other categories (emails, phone numbers, addresses) are only checked in the browser.
- A security assessment and its open items are in `docs/security-audit/`.
