terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.25.0, < 7.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6.0"
    }
  }
}

variable "env_name" {
  type = string
}

variable "app_name" {
  type    = string
  default = "securemind"
}

variable "api_base_url" {
  type    = string
  default = ""
}

variable "cognito_user_pool_id" {
  type = string
}

variable "cognito_user_pool_arn" {
  type = string
}

variable "cognito_client_id" {
  type = string
}

variable "cognito_region" {
  type = string
}

variable "cognito_issuer" {
  type = string
}

variable "auth_mode" {
  type    = string
  default = "cognito"
}

variable "branch_name" {
  type    = string
  default = "main"
}

data "aws_iam_policy_document" "amplify_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["amplify.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "amplify" {
  name               = "securemind-amplify-${var.env_name}"
  assume_role_policy = data.aws_iam_policy_document.amplify_assume.json
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

resource "aws_iam_role_policy_attachment" "amplify" {
  role       = aws_iam_role.amplify.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess-Amplify"
}

# AdministratorAccess-Amplify does not include CloudWatch Logs. Without this,
# compute crashes (HTTP 500) leave `/aws/amplify/<app>` at 0 bytes.
data "aws_iam_policy_document" "amplify_logs" {
  statement {
    sid     = "AmplifySSRLogs"
    actions = ["logs:CreateLogGroup", "logs:DescribeLogGroups"]
    resources = [
      "arn:aws:logs:*:*:log-group:/aws/amplify/*",
    ]
  }
  statement {
    sid     = "AmplifySSRLogStreams"
    actions = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [
      "arn:aws:logs:*:*:log-group:/aws/amplify/*:log-stream:*",
    ]
  }
}

resource "aws_iam_role_policy" "amplify_logs" {
  name   = "securemind-amplify-logs-${var.env_name}"
  role   = aws_iam_role.amplify.id
  policy = data.aws_iam_policy_document.amplify_logs.json
}

# First-run claim uses AdminCreateUser from Amplify compute (not Lambda).
data "aws_iam_policy_document" "amplify_cognito_admin" {
  statement {
    sid = "FirstAdminClaim"
    actions = [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminSetUserPassword",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:ListUsers",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:AdminGetUser",
    ]
    resources = [var.cognito_user_pool_arn]
  }
  # ListUsers is sometimes denied when scoped only to the pool ARN.
  statement {
    sid     = "FirstAdminListUsers"
    actions = ["cognito-idp:ListUsers"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "amplify_cognito_admin" {
  name   = "securemind-amplify-cognito-admin-${var.env_name}"
  role   = aws_iam_role.amplify.id
  policy = data.aws_iam_policy_document.amplify_cognito_admin.json
}

resource "random_id" "instance_encryption" {
  byte_length = 32
}

# Printed once via `terraform output -raw setup_claim_secret`. Never put on the public page.
resource "random_password" "setup_claim" {
  length  = 32
  special = false
}

resource "aws_amplify_app" "this" {
  name                 = "${var.app_name}-${var.env_name}"
  description          = "SecureMind UI (API stays on API Gateway + Lambda)"
  platform             = "WEB_COMPUTE"
  iam_service_role_arn = aws_iam_role.amplify.arn
  # Distinct from the service role: injected into Next.js compute so AdminCreateUser works.
  compute_role_arn     = aws_iam_role.amplify.arn

  build_spec = <<-EOT
    version: 1
    frontend:
      phases:
        preBuild:
          commands:
            - export DATABASE_URL="$${DATABASE_URL:-postgresql://ci:ci@127.0.0.1:5432/ci}"
            - export DIRECT_URL="$${DIRECT_URL:-postgresql://ci:ci@127.0.0.1:5432/ci}"
            - npm ci
            - npx prisma generate
        build:
          commands:
            - export DATABASE_URL="$${DATABASE_URL:-postgresql://ci:ci@127.0.0.1:5432/ci}"
            - export DIRECT_URL="$${DIRECT_URL:-postgresql://ci:ci@127.0.0.1:5432/ci}"
            - node -e "const fs=require('fs'); const k=['DATABASE_URL','DIRECT_URL','AUTH_MODE','AUTH_ALLOW_LOCAL_FALLBACK','COGNITO_USER_POOL_ID','COGNITO_CLIENT_ID','COGNITO_REGION','COGNITO_ISSUER','NEXT_PUBLIC_API_BASE_URL','INSTANCE_ENCRYPTION_KEY','SETUP_CLAIM_SECRET']; fs.appendFileSync('.env.production', k.map(n=>n+'='+(process.env[n]||'')).join('\\n')+'\\nSECUREMIND_EDITION=cloud\\nSTORAGE_BACKEND=dynamodb\\n');"
            - npm run build
            - node infra/scripts/amplify-prune-compute.mjs
      artifacts:
        baseDirectory: .next
        files:
          - "**/*"
      cache:
        paths:
          - node_modules/**/*
          - .next/cache/**/*
  EOT

  environment_variables = {
    AUTH_MODE                 = var.auth_mode
    AUTH_ALLOW_LOCAL_FALLBACK = "false"
    COGNITO_USER_POOL_ID      = var.cognito_user_pool_id
    COGNITO_CLIENT_ID         = var.cognito_client_id
    COGNITO_REGION            = var.cognito_region
    COGNITO_ISSUER            = var.cognito_issuer
    NEXT_PUBLIC_API_BASE_URL  = var.api_base_url
    SECUREMIND_EDITION        = "cloud"
    STORAGE_BACKEND           = "dynamodb"
    INSTANCE_ENCRYPTION_KEY   = random_id.instance_encryption.hex
    SETUP_CLAIM_SECRET        = random_password.setup_claim.result
    # Generate-only dummy; Amplify runtime has no Postgres.
    DATABASE_URL              = "postgresql://ci:ci@127.0.0.1:5432/ci"
    DIRECT_URL                = "postgresql://ci:ci@127.0.0.1:5432/ci"
  }

  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }

  # Operator connects GitHub in the Amplify console (GitHub App). Never store a PAT here.
  lifecycle {
    ignore_changes = [repository, access_token, oauth_token]
  }
}

output "app_id" {
  value = aws_amplify_app.this.id
}

output "default_domain" {
  value = aws_amplify_app.this.default_domain
}

output "console_url" {
  value = "https://console.aws.amazon.com/amplify/home#/${aws_amplify_app.this.id}"
}

output "branch_name" {
  value = var.branch_name
}

output "setup_claim_secret" {
  value     = random_password.setup_claim.result
  sensitive = true
}
