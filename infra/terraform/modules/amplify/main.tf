terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.25.0, < 7.0.0"
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

resource "aws_amplify_app" "this" {
  name                 = "${var.app_name}-${var.env_name}"
  description          = "SecureMind UI (API stays on API Gateway + Lambda)"
  platform             = "WEB_COMPUTE"
  iam_service_role_arn = aws_iam_role.amplify.arn

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
