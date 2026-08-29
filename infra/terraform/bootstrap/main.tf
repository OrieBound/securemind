variable "env_name" {
  type        = string
  default     = "sandbox"
  description = "Used in resource names (state bucket suffix, role name)."
}

variable "github_repository" {
  type        = string
  description = "GitHub repo in owner/name form, e.g. acme/securemind."
}

variable "github_environment" {
  type        = string
  default     = "aws-sandbox"
  description = "GitHub Environment name that may assume the deploy role."
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  repo         = var.github_repository
  state_bucket = "securemind-tfstate-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.name}"
  lock_table   = "securemind-tflock-${var.env_name}"
  deploy_role  = "securemind-gha-${var.env_name}"
}

resource "aws_s3_bucket" "state" {
  bucket        = local.state_bucket
  force_destroy = false
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "lock" {
  name         = local.lock_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  attribute {
    name = "LockID"
    type = "S"
  }
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # AWS no longer validates GitHub OIDC thumbprints; 40 hex chars still required by the provider.
  thumbprint_list = ["ffffffffffffffffffffffffffffffffffffffff"]
}

data "aws_iam_policy_document" "gha_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${local.repo}:environment:${var.github_environment}",
        "repo:${local.repo}:ref:refs/heads/main",
        "repo:${local.repo}:pull_request",
      ]
    }
  }
}

resource "aws_iam_role" "gha" {
  name               = local.deploy_role
  assume_role_policy = data.aws_iam_policy_document.gha_trust.json
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

data "aws_iam_policy_document" "gha_deploy" {
  statement {
    sid = "SandboxDeploy"
    actions = [
      "amplify:*",
      "apigateway:*",
      "cloudformation:*",
      "cloudwatch:*",
      "cognito-idp:*",
      "dynamodb:*",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:PassRole",
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:CreatePolicy",
      "iam:CreatePolicyVersion",
      "iam:DeletePolicy",
      "iam:ListPolicyVersions",
      "lambda:*",
      "logs:*",
      "secretsmanager:*",
      "s3:GetObject",
      "s3:PutObject",
      "s3:ListBucket",
      "iam:ListOpenIDConnectProviders",
      "iam:GetOpenIDConnectProvider",
      "sts:GetCallerIdentity",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "gha_deploy" {
  name   = "securemind-gha-deploy-${var.env_name}"
  role   = aws_iam_role.gha.id
  policy = data.aws_iam_policy_document.gha_deploy.json
}

output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

output "lock_table" {
  value = aws_dynamodb_table.lock.name
}

output "gha_role_arn" {
  value = aws_iam_role.gha.arn
}

output "oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}

output "backend_hcl" {
  value = <<-EOT
    bucket         = "${aws_s3_bucket.state.bucket}"
    key            = "securemind/${var.env_name}/terraform.tfstate"
    region         = "${data.aws_region.current.name}"
    dynamodb_table = "${aws_dynamodb_table.lock.name}"
    encrypt        = true
  EOT
}
