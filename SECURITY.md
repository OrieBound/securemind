# Security

SecureMind is a personal project shared as is. It reduces the risk of sending sensitive details to a model. It does not guarantee that every sensitive value is found, and it is not a compliance program. See the [license](LICENSE) for the terms.

## Reporting a problem

Please report a vulnerability privately, so it can be fixed before it is public:

1. Use **Security → Report a vulnerability** on this repository's GitHub page.
2. If that is not available, email [hello@securemind.chat](mailto:hello@securemind.chat?subject=Security%20report) and say you have a security report. You can also use the [Contact page](https://securemind.chat/contact/). Please do not put details in a public issue or a public post.

Include what you found, the steps to reproduce it and the version or commit. The author reads reports and will try to answer, but there is no promised response time or support agreement.

## What is in scope

- The application code in this repository.
- The Terraform and scripts in `infra/`, including the IAM roles and policies they create.

Your own install is yours to run. A report about how an operator configured their own AWS account or Docker host is outside what can be fixed here.

## How the project is built to limit damage

- **Nothing is shared between installs.** There is no central service. Each install holds its own keys, data and users, and the author has no access to any of them.
- **The deploy role trusts one repository.** The role the setup creates for GitHub Actions can only be assumed by your repository, matched by its numeric IDs, running in one named GitHub environment. A copy of the code in another repository cannot use it. Its writes are limited to resources named for SecureMind, and it can only create roles that carry a permission boundary. It cannot edit itself.
- **No cloud credentials in the app or the repository.** An AWS access key is never accepted through the interface and never stored in the database. Vendor API keys are encrypted at rest, and the interface only shows the last four characters.
- **Sensitive values are replaced before they leave the browser.** There is no restore path. The original value is not saved or logged. The server checks every chat request again for social security and social insurance numbers, card numbers and secrets.
- **Sign-in is closed by default.** Accounts are created by an admin, and the first account needs a one-time setup code on both Docker and AWS. Sign-in fails closed when it is misconfigured, sign-in attempts are rate limited, signing out or suspending someone ends their sessions, and only the Owner can change another admin. Every admin change is kept in an audit log.
- **The open API address is rate limited and checks sign-in first.** API Gateway checks the Cognito token before the chat function runs, the function checks it again, and the gateway caps request rates so a flood cannot run up a large bill.
- **The AWS install can recover and is watched.** Point-in-time recovery and deletion protection on the database, deletion protection on the user directory, an activity trail (CloudTrail), alarms and a monthly budget alert.
- **Docker is locked down by default.** Only the app is reachable, and only from the same computer. An HTTPS front end is included for other computers. Containers run without extra privileges, and uploads are size- and zip-bomb-checked before parsing.

## Who it is for

SecureMind is intended for small to mid-sized teams. One install serves one organization: **1 to 25 people is the recommended range**, and it can serve **up to about 100 people** with a few adjustments (an AWS concurrency limit, a realistic budget, and two-step verification for admins). Separate organizations should each run their own install. An AWS web application firewall is not included, to keep cost near zero; you can add one to your own account.

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
