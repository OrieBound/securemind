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
  repo_owner   = split("/", var.github_repository)[0]
  repo_name    = split("/", var.github_repository)[1]
  state_bucket = "securemind-tfstate-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.name}"
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
      # Two GitHub `sub` shapes, plus environment vs branch vs PR:
      #   repo:owner/name:environment:aws-sandbox
      #   repo:owner@OWNER_ID/name@REPO_ID:environment:aws-sandbox
      # Repos created after 2026-07-15 (or opted in) emit the ID form.
      # StringEquals + a wildcard is a silent no-match — must be StringLike.
      values = [
        "repo:${local.repo}:*",
        "repo:${local.repo_owner}@*/${local.repo_name}@*:*",
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
      "lambda:*",
      "logs:*",
      "secretsmanager:*",
      "sts:GetCallerIdentity",
      # AWS provider probes these on almost every apply.
      "ec2:DescribeAccountAttributes",
      "ec2:DescribeAvailabilityZones",
      # App stack creates Lambda / Amplify / Bedrock-lab IAM.
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListRoles",
      "iam:ListPolicies",
      "iam:ListPolicyVersions",
      "iam:ListOpenIDConnectProviders",
      "iam:GetOpenIDConnectProvider",
      "iam:PassRole",
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:UpdateRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:CreatePolicy",
      "iam:CreatePolicyVersion",
      "iam:DeletePolicy",
      "iam:DeletePolicyVersion",
      "iam:TagPolicy",
      "iam:UntagPolicy",
      "iam:CreateServiceLinkedRole",
      # Terraform S3 backend (state object replace/delete).
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
      "s3:GetBucketLocation",
      "s3:GetBucketVersioning",
    ]
    resources = ["*"]
  }

  # App stack creates securemind-avatars-<env>-<account>. Backend actions above
  # do not include CreateBucket / bucket settings.
  statement {
    sid     = "AvatarBucket"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::securemind-avatars-*",
      "arn:aws:s3:::securemind-avatars-*/*",
    ]
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

output "gha_role_arn" {
  value = aws_iam_role.gha.arn
}

output "oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}

output "backend_hcl" {
  value = <<-EOT
    bucket       = "${aws_s3_bucket.state.bucket}"
    key          = "securemind/${var.env_name}/terraform.tfstate"
    region       = "${data.aws_region.current.name}"
    use_lockfile = true
    encrypt      = true
  EOT
}
