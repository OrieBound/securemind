# Docs Index

SecureMind is a privacy-aware AI workspace for managing models, knowledge, memory, cost, and sensitive-data risk. Sanitization is risk reduction, not a security or compliance guarantee.

## How it works
- [Feature guide](./feature-guide.md) — every page and setting, and why it is there
- [Technical source brief](./technical-source-brief.md) — routing, detection, retrieval, hosting
- [Two-step verification (authenticator-app codes)](./mfa.md)
- Word versions: [Feature Guide](./SecureMind-Feature-Guide.docx) · [Technical Guide](./SecureMind-Technical-Guide.docx)

## Install and deploy
- [Deploy: On-Prem Docker](./deploy/on-prem-docker.md)
- [Deploy: Your own AWS account, from zero](./deploy/aws-from-zero.md)
- [Deploy: Custom domain (registrar stays, Route53 DNS)](./deploy/custom-domain.md)
- [Deploy: Static sites (S3 + CloudFront, Terraform)](./deploy/static-sites.md)
- [Deploy: Hosted sandbox roadblocks](./deploy/hosted-sandbox-roadblocks.md) — lab notes, not the install guide
- [Diagram: on-prem](./diagrams/securemind-onprem-diagram.jpg) · [source](./diagrams/securemind-onprem.drawio)
- [Diagram: AWS](./diagrams/securemind-aws-diagram.jpg) · [source](./diagrams/securemind-aws.drawio)

## Decisions
- [ADR 0001: Ingestion Pipeline](./adr/0001-ingestion-pipeline.md)
- [ADR 0002: Storage Choice](./adr/0002-storage-choice.md)
- [ADR 0003: Local AWS Scaffolding](./adr/0003-local-aws-scaffolding.md)
- [ADR 0004: Amplify + Lambda Hosting](./adr/0004-amplify-lambda-hosting.md)
- [ADR 0005: Admin Security Policy](./adr/0005-admin-security-policy.md)
- [ADR 0006: On-Prem Docker](./adr/0006-on-prem-docker.md)
- [ADR 0007: Hosted DynamoDB vectors](./adr/0007-hosted-dynamodb-vectors.md)
- [ADR 0008: Terraform + GitHub Actions OIDC](./adr/0008-terraform-github-oidc.md)
- [ADR 0009: Direct live captions](./adr/0009-direct-live-captions.md)

## Security, testing, history
- [Security assessment](./security-audit/)
- [Test files (synthetic Knowledge corpus)](./test-files/README.md)
- [Archive](./archive/) — historical documents, not current (older education guide, Floci lab notes, early Word drafts)
