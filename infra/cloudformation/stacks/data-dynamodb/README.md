# Hosted Knowledge fragments (DynamoDB)

See [ADR 0007](../../../../docs/adr/0007-hosted-dynamodb-vectors.md) and [ADR 0008](../../../../docs/adr/0008-terraform-github-oidc.md).

This CloudFormation template is **archived**. Terraform calls a copy at `infra/terraform/modules/data_dynamodb/fragments.cfn.yaml`.

| Target | How |
|---|---|
| Local Floci | `npm run floci:dynamodb` |
| Real AWS | `npm run infra:up` (Terraform) |

Do not apply until you mean to create billable resources.
