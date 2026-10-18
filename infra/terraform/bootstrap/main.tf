variable "env_name" {
  type        = string
  default     = "sandbox"
  description = "Used in resource names (state bucket suffix, role name)."
}

variable "github_subject_prefix" {
  type        = string
  description = "The repository part of the GitHub OIDC subject, with the numeric owner and repository IDs, for example repo:owner@123/name@456. Read it with: gh api repos/OWNER/REPO/actions/oidc/customization/sub --jq .sub_claim_prefix"

  validation {
    condition     = can(regex("^repo:[A-Za-z0-9_.-]+@[0-9]+/[A-Za-z0-9_.-]+@[0-9]+$", var.github_subject_prefix))
    error_message = "github_subject_prefix must look like repo:owner@123/name@456, with the numeric IDs. A plain repo:owner/name would trust whoever later owns that name. Read the value with: gh api repos/OWNER/REPO/actions/oidc/customization/sub --jq .sub_claim_prefix. If it has no @ IDs, turn on immutable subjects for the repository first."
  }
}

variable "github_environment" {
  type        = string
  default     = "aws-sandbox"
  description = "The one GitHub Environment whose workflows may assume the deploy role. Give it required reviewers."
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account       = data.aws_caller_identity.current.account_id
  state_bucket  = "securemind-tfstate-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.name}"
  deploy_role   = "securemind-gha-${var.env_name}"
  boundary_name = "securemind-gha-boundary-${var.env_name}"
  role_glob     = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/securemind-*"
  policy_globs = [
    "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/securemind-*",
    "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/SecureMind-*",
  ]
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

# ---------------------------------------------------------------------------------------------
# Who may assume the deploy role
#
# The trust policy is the one-to-one link between this AWS account and ONE GitHub repository.
# GitHub signs a token for every workflow run, and AWS accepts it only if both conditions hold:
#   * the audience is sts.amazonaws.com, and
#   * the subject is exactly this repository (by its numeric owner and repository IDs, which
#     cannot be reused if a name is released) running in exactly this GitHub Environment.
# A copy of the code in anyone else's repository, a fork, another branch without the
# Environment, or a pull request cannot match. Give the Environment required reviewers so that
# a person approves each run.
# ---------------------------------------------------------------------------------------------

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
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.github_subject_prefix}:environment:${var.github_environment}"]
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

# ---------------------------------------------------------------------------------------------
# Permission boundary for every role the deploy role creates
#
# A boundary caps what a role can ever do, whatever policies are attached to it. The deploy role
# may only create or change roles that carry this boundary, so a hijacked workflow cannot mint a
# more powerful role. The boundary lists what the app's roles need, and denies IAM changes.
# Attach it by giving the app stack TF_VAR_permissions_boundary_arn (the output below).
# ---------------------------------------------------------------------------------------------

data "aws_iam_policy_document" "boundary" {
  statement {
    sid = "AppTables"
    actions = [
      "dynamodb:BatchWriteItem",
      "dynamodb:DeleteItem",
      "dynamodb:DescribeTable",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:SearchVectors",
      "dynamodb:UpdateItem",
    ]
    resources = [
      "arn:aws:dynamodb:*:${local.account}:table/securemind-*",
      "arn:aws:dynamodb:*:${local.account}:table/securemind-*/index/*",
    ]
  }
  statement {
    sid       = "AppParameters"
    actions   = ["ssm:GetParameter", "ssm:PutParameter"]
    resources = ["arn:aws:ssm:*:${local.account}:parameter/securemind/*"]
  }
  statement {
    sid       = "AppSecretsOlderInstalls"
    actions   = ["secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue"]
    resources = ["arn:aws:secretsmanager:*:${local.account}:secret:securemind/*"]
  }
  statement {
    sid     = "Avatars"
    actions = ["s3:DeleteObject", "s3:GetObject", "s3:ListBucket", "s3:PutObject"]
    resources = [
      "arn:aws:s3:::securemind-avatars-*",
      "arn:aws:s3:::securemind-avatars-*/*",
    ]
  }
  statement {
    sid     = "Logs"
    actions = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [
      "arn:aws:logs:*:${local.account}:log-group:/aws/lambda/securemind-*",
      "arn:aws:logs:*:${local.account}:log-group:/aws/lambda/securemind-*:*",
      "arn:aws:logs:*:${local.account}:log-group:/aws/amplify/*",
      "arn:aws:logs:*:${local.account}:log-group:/aws/amplify/*:*",
    ]
  }
  statement {
    sid       = "LogsList"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }
  statement {
    sid = "Models"
    actions = [
      "bedrock:GetFoundationModel",
      "bedrock:GetFoundationModelAvailability",
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:ListFoundationModels",
      "bedrock:ListInferenceProfiles",
      "transcribe:StartStreamTranscription",
    ]
    resources = ["*"]
  }
  statement {
    sid = "Directory"
    actions = [
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:AdminEnableUser",
      "cognito-idp:AdminRemoveUserFromGroup",
      "cognito-idp:AdminResetUserPassword",
      "cognito-idp:AdminSetUserMFAPreference",
      "cognito-idp:AdminUserGlobalSignOut",
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminGetUser",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:AdminSetUserPassword",
      "cognito-idp:ListUsers",
    ]
    resources = ["arn:aws:cognito-idp:*:${local.account}:userpool/*"]
  }
  # Amplify Hosting acts through the app's service role. These are the parts of Amplify, its
  # own build artifacts and its own stacks that the hosting service needs.
  statement {
    sid       = "AmplifyHosting"
    actions   = ["amplify:*"]
    resources = ["arn:aws:amplify:*:${local.account}:apps/*"]
  }
  statement {
    sid       = "AmplifyArtifacts"
    actions   = ["s3:*"]
    resources = ["arn:aws:s3:::amplify-*", "arn:aws:s3:::amplify-*/*"]
  }
  statement {
    sid       = "AmplifyStacks"
    actions   = ["cloudformation:*"]
    resources = ["arn:aws:cloudformation:*:${local.account}:stack/amplify-*/*"]
  }

  # Belt and braces: whatever else is attached, a bounded role can never change IAM.
  statement {
    sid       = "NeverChangeIdentity"
    effect    = "Deny"
    actions   = ["iam:*", "organizations:*", "account:*"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "boundary" {
  name        = local.boundary_name
  description = "Permission boundary for roles created by the SecureMind deploy role."
  policy      = data.aws_iam_policy_document.boundary.json
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

# ---------------------------------------------------------------------------------------------
# What the deploy role may do. Reads are broad so Terraform can plan. Writes are limited to
# resources named securemind-* wherever AWS lets a name be matched.
# ---------------------------------------------------------------------------------------------

data "aws_iam_policy_document" "gha_deploy" {
  statement {
    sid = "ReadForPlan"
    actions = [
      "amplify:Get*",
      "amplify:List*",
      "apigateway:GET",
      "cloudformation:Describe*",
      "cloudformation:Get*",
      "cloudformation:List*",
      "cloudwatch:Describe*",
      "cloudwatch:Get*",
      "cloudwatch:List*",
      "cloudtrail:Describe*",
      "cloudtrail:Get*",
      "cloudtrail:List*",
      "cloudtrail:LookupEvents",
      "sns:Get*",
      "sns:List*",
      "budgets:Describe*",
      "budgets:View*",
      "cognito-idp:Describe*",
      "cognito-idp:Get*",
      "cognito-idp:List*",
      "dynamodb:Describe*",
      "dynamodb:List*",
      "lambda:Get*",
      "lambda:List*",
      "logs:Describe*",
      "logs:List*",
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetResourcePolicy",
      "secretsmanager:ListSecrets",
      "ssm:DescribeParameters",
      "sts:GetCallerIdentity",
      # AWS provider probes these on almost every apply.
      "ec2:DescribeAccountAttributes",
      "ec2:DescribeAvailabilityZones",
      # Read-only IAM, so Terraform can compare what exists.
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
    ]
    resources = ["*"]
  }

  statement {
    sid       = "Functions"
    actions   = ["lambda:*"]
    resources = ["arn:aws:lambda:*:${local.account}:function:securemind-*"]
  }
  statement {
    sid     = "LogGroups"
    actions = ["logs:*"]
    resources = [
      "arn:aws:logs:*:${local.account}:log-group:/aws/lambda/securemind-*",
      "arn:aws:logs:*:${local.account}:log-group:/aws/lambda/securemind-*:*",
      "arn:aws:logs:*:${local.account}:log-group:/aws/amplify/*",
      "arn:aws:logs:*:${local.account}:log-group:/aws/amplify/*:*",
    ]
  }
  statement {
    sid     = "Tables"
    actions = ["dynamodb:*"]
    resources = [
      "arn:aws:dynamodb:*:${local.account}:table/securemind-*",
      "arn:aws:dynamodb:*:${local.account}:table/securemind-*/*",
    ]
  }
  statement {
    sid       = "Stacks"
    actions   = ["cloudformation:*"]
    resources = ["arn:aws:cloudformation:*:${local.account}:stack/securemind-*/*"]
  }
  statement {
    sid       = "OlderSecrets"
    actions   = ["secretsmanager:*"]
    resources = ["arn:aws:secretsmanager:*:${local.account}:secret:securemind/*"]
  }
  statement {
    sid = "Parameters"
    actions = [
      "ssm:AddTagsToResource",
      "ssm:DeleteParameter",
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:ListTagsForResource",
      "ssm:PutParameter",
      "ssm:RemoveTagsFromResource",
    ]
    resources = ["arn:aws:ssm:*:${local.account}:parameter/securemind/*"]
  }
  statement {
    sid       = "Gateway"
    actions   = ["apigateway:*"]
    resources = ["arn:aws:apigateway:*::/*"]
  }
  statement {
    sid       = "AmplifyApps"
    actions   = ["amplify:*"]
    resources = ["arn:aws:amplify:*:${local.account}:apps/*"]
  }
  statement {
    # A user pool's name is not part of its ARN, so this cannot be narrowed by name.
    sid       = "UserPools"
    actions   = ["cognito-idp:*"]
    resources = ["*"]
  }
  statement {
    sid = "Alarms"
    actions = [
      "cloudwatch:DeleteAlarms",
      "cloudwatch:PutMetricAlarm",
      "cloudwatch:TagResource",
      "cloudwatch:UntagResource",
    ]
    resources = ["arn:aws:cloudwatch:*:${local.account}:alarm:securemind-*"]
  }
  statement {
    sid       = "AlertTopics"
    actions   = ["sns:*"]
    resources = ["arn:aws:sns:*:${local.account}:securemind-*"]
  }
  statement {
    sid       = "Budgets"
    actions   = ["budgets:*"]
    resources = ["arn:aws:budgets::${local.account}:budget/securemind-*"]
  }
  statement {
    sid       = "AuditTrail"
    actions   = ["cloudtrail:*"]
    resources = ["arn:aws:cloudtrail:*:${local.account}:trail/securemind-*"]
  }
  statement {
    sid       = "AuditTrailBucket"
    actions   = ["s3:*"]
    resources = ["arn:aws:s3:::securemind-trail-*", "arn:aws:s3:::securemind-trail-*/*"]
  }
  statement {
    sid       = "Dashboards"
    actions   = ["cloudwatch:DeleteDashboards", "cloudwatch:GetDashboard", "cloudwatch:PutDashboard"]
    resources = ["arn:aws:cloudwatch::${local.account}:dashboard/*"]
  }
  statement {
    # Terraform's own state, and nothing else in S3 except the avatar bucket below.
    sid = "TerraformState"
    actions = [
      "s3:DeleteObject",
      "s3:GetBucketLocation",
      "s3:GetBucketVersioning",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject",
    ]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
  }
  statement {
    sid     = "AvatarBucket"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::securemind-avatars-*",
      "arn:aws:s3:::securemind-avatars-*/*",
    ]
  }

  # --- IAM: only securemind-* roles, only with the boundary, only known policies -------------
  statement {
    sid       = "CreateBoundedRoles"
    actions   = ["iam:CreateRole"]
    resources = [local.role_glob]
    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"
      values   = [aws_iam_policy.boundary.arn]
    }
  }
  statement {
    sid = "ChangeBoundedRoles"
    actions = [
      "iam:DeleteRolePolicy",
      "iam:DetachRolePolicy",
      "iam:PutRolePolicy",
    ]
    resources = [local.role_glob]
    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"
      values   = [aws_iam_policy.boundary.arn]
    }
  }
  statement {
    sid       = "AttachKnownPolicies"
    actions   = ["iam:AttachRolePolicy"]
    resources = [local.role_glob]
    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"
      values   = [aws_iam_policy.boundary.arn]
    }
    condition {
      test     = "ArnLike"
      variable = "iam:PolicyARN"
      values = concat(local.policy_globs, [
        "arn:aws:iam::aws:policy/AdministratorAccess-Amplify",
        "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
      ])
    }
  }
  statement {
    sid       = "SetTheBoundary"
    actions   = ["iam:PutRolePermissionsBoundary"]
    resources = [local.role_glob]
    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"
      values   = [aws_iam_policy.boundary.arn]
    }
  }
  statement {
    sid = "ManageRoleDetails"
    actions = [
      "iam:DeleteRole",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRole",
    ]
    resources = [local.role_glob]
  }
  statement {
    sid = "ManagePolicies"
    actions = [
      "iam:CreatePolicy",
      "iam:CreatePolicyVersion",
      "iam:DeletePolicy",
      "iam:DeletePolicyVersion",
      "iam:TagPolicy",
      "iam:UntagPolicy",
    ]
    resources = local.policy_globs
  }
  statement {
    sid       = "PassRolesToTheAppServices"
    actions   = ["iam:PassRole"]
    resources = [local.role_glob]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["amplify.amazonaws.com", "apigateway.amazonaws.com", "cloudformation.amazonaws.com", "lambda.amazonaws.com"]
    }
  }
  statement {
    sid       = "ServiceLinkedRoles"
    actions   = ["iam:CreateServiceLinkedRole"]
    resources = ["arn:aws:iam::*:role/aws-service-role/*"]
  }

  # --- Things this role may never change, whatever else it is allowed -------------------------
  statement {
    sid    = "NeverChangeItself"
    effect = "Deny"
    actions = [
      "iam:AttachRolePolicy",
      "iam:DeleteRole",
      "iam:DeleteRolePolicy",
      "iam:DetachRolePolicy",
      "iam:PutRolePolicy",
      "iam:PutRolePermissionsBoundary",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRole",
    ]
    resources = [aws_iam_role.gha.arn]
  }
  statement {
    sid    = "NeverChangeTheBoundary"
    effect = "Deny"
    actions = [
      "iam:CreatePolicyVersion",
      "iam:DeletePolicy",
      "iam:DeletePolicyVersion",
      "iam:SetDefaultPolicyVersion",
    ]
    resources = [aws_iam_policy.boundary.arn]
  }
  statement {
    sid       = "NeverRemoveABoundary"
    effect    = "Deny"
    actions   = ["iam:DeleteRolePermissionsBoundary"]
    resources = ["*"]
  }
  statement {
    sid    = "NeverChangeTheIdentityProvider"
    effect = "Deny"
    actions = [
      "iam:AddClientIDToOpenIDConnectProvider",
      "iam:CreateOpenIDConnectProvider",
      "iam:DeleteOpenIDConnectProvider",
      "iam:RemoveClientIDFromOpenIDConnectProvider",
      "iam:TagOpenIDConnectProvider",
      "iam:UntagOpenIDConnectProvider",
      "iam:UpdateOpenIDConnectProviderThumbprint",
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

output "gha_role_arn" {
  value = aws_iam_role.gha.arn
}

output "permissions_boundary_arn" {
  value       = aws_iam_policy.boundary.arn
  description = "Give this to the app stack as TF_VAR_permissions_boundary_arn (the GitHub variable PERMISSIONS_BOUNDARY_ARN) so roles created from CI carry the boundary."
}

output "oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}

output "trusted_subject" {
  value       = "${var.github_subject_prefix}:environment:${var.github_environment}"
  description = "The only GitHub subject that can assume the deploy role."
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
