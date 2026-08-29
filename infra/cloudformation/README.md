# Archived CloudFormation (superseded)

SecureMind cloud IaC is **Terraform** under [`../terraform/`](../terraform/). These YAML templates are kept so git history stays obvious. Do not deploy them.

The DynamoDB vector-index snippet is still referenced from Terraform as a nested template (`infra/terraform/modules/data_dynamodb/fragments.cfn.yaml`) until the AWS provider ships `aws_dynamodb_vector_index`.

Aurora (`stacks/data-aurora`) stays parked — not part of the default cloud stack.
