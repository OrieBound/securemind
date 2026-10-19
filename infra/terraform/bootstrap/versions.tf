# One-time laptop bootstrap (sandbox)
#
#   cd infra/terraform/bootstrap
#   aws sso login --profile <sandbox>
#   terraform init
#   terraform apply -var="github_repository=YOUR_ORG/securemind"
#
# Then copy `backend_hcl` output into ../backend.hcl and create the
# GitHub Environment `aws-sandbox` with AWS_ROLE_ARN = gha_role_arn.
# Do not commit terraform.tfstate.
#
# Re-apply this directory (not infra:up) after changing OIDC trust or
# the GHA deploy policy. The app stack does not own these resources.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.25.0, < 7.0.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}
