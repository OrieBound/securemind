terraform {
  required_version = ">= 1.6.0"
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.25.0, < 7.0.0"
    }
  }
  # After bootstrap: terraform init -backend-config=backend.hcl
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
}

provider "random" {}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "env_name" {
  type    = string
  default = "sandbox"
}

variable "groq_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "allowed_origin" {
  type    = string
  default = "http://localhost:3000"
}

variable "amplify_branch" {
  type    = string
  default = "main"
}

variable "embed_dimensions" {
  type    = number
  default = 1024
}

variable "create_cognito_domain" {
  type    = bool
  default = false
}

variable "create_bedrock_dashboard" {
  type    = bool
  default = true
}

variable "auth_mode" {
  type    = string
  default = "cognito"
}

locals {
  chat_zip = "${path.module}/.build/lambda/chat.zip"
  warm_zip = "${path.module}/.build/lambda/warm.zip"
}

module "bedrock_lab" {
  source           = "./modules/bedrock_lab"
  env_name         = var.env_name
  create_dashboard = var.create_bedrock_dashboard
}

module "auth_cognito" {
  source        = "./modules/auth_cognito"
  env_name      = var.env_name
  create_domain = var.create_cognito_domain
}

module "data_dynamodb" {
  source           = "./modules/data_dynamodb"
  env_name         = var.env_name
  embed_dimensions = var.embed_dimensions
}

module "secrets" {
  source               = "./modules/secrets"
  env_name             = var.env_name
  fragments_table_name = module.data_dynamodb.table_name
  groq_api_key         = var.groq_api_key
}

# Bootstrap GHA policy is not applied on push. The deploy role already has
# iam:PutRolePolicy, so the app stack grants avatar-bucket S3 before CreateBucket.
data "aws_iam_role" "gha" {
  name = "securemind-gha-${var.env_name}"
}

data "aws_iam_policy_document" "gha_avatars" {
  statement {
    sid     = "AvatarBucket"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::securemind-avatars-*",
      "arn:aws:s3:::securemind-avatars-*/*",
    ]
  }
}

resource "aws_iam_role_policy" "gha_avatars" {
  name   = "securemind-gha-avatars-${var.env_name}"
  role   = data.aws_iam_role.gha.id
  policy = data.aws_iam_policy_document.gha_avatars.json
}

resource "terraform_data" "gha_avatars_wait" {
  input = aws_iam_role_policy.gha_avatars.id
  provisioner "local-exec" {
    command = "sleep 20"
  }
}

module "api" {
  source                 = "./modules/api"
  env_name               = var.env_name
  allowed_origin         = var.allowed_origin
  chat_zip_path          = local.chat_zip
  warm_zip_path          = local.warm_zip
  fragments_table_name   = module.data_dynamodb.table_name
  fragments_table_arn    = module.data_dynamodb.table_arn
  fragments_secret_arn   = module.secrets.fragments_table_secret_arn
  groq_secret_arn        = module.secrets.groq_secret_arn
  vendor_keys_secret_arn = module.secrets.vendor_keys_secret_arn
  auth_mode              = var.auth_mode
  cognito_user_pool_id   = module.auth_cognito.user_pool_id
  cognito_client_id      = module.auth_cognito.client_id
  cognito_region         = var.aws_region
  cognito_issuer         = module.auth_cognito.issuer
  embed_dimensions       = tostring(var.embed_dimensions)
  depends_on             = [terraform_data.gha_avatars_wait]
}

module "amplify" {
  source                 = "./modules/amplify"
  env_name               = var.env_name
  api_base_url           = module.api.api_base_url
  cognito_user_pool_id   = module.auth_cognito.user_pool_id
  cognito_user_pool_arn  = module.auth_cognito.user_pool_arn
  cognito_client_id      = module.auth_cognito.client_id
  cognito_region         = var.aws_region
  cognito_issuer         = module.auth_cognito.issuer
  auth_mode              = var.auth_mode
  branch_name            = var.amplify_branch
  fragments_table_name   = module.data_dynamodb.table_name
  fragments_table_arn    = module.data_dynamodb.table_arn
  vendor_keys_secret_arn = module.secrets.vendor_keys_secret_arn
  avatar_s3_bucket_name  = module.api.avatar_bucket_name
}

output "api_base_url" {
  value = module.api.api_base_url
}

output "user_pool_id" {
  value = module.auth_cognito.user_pool_id
}

output "client_id" {
  value = module.auth_cognito.client_id
}

output "issuer" {
  value = module.auth_cognito.issuer
}

output "fragments_table_name" {
  value = module.data_dynamodb.table_name
}

output "fragments_table_arn" {
  value = module.data_dynamodb.table_arn
}

output "amplify_app_id" {
  value = module.amplify.app_id
}

output "amplify_default_domain" {
  value = module.amplify.default_domain
}

output "amplify_console_url" {
  value = module.amplify.console_url
}

output "amplify_branch" {
  value = module.amplify.branch_name
}

output "setup_claim_secret" {
  value       = module.amplify.setup_claim_secret
  sensitive   = true
  description = "One-time hosted first-admin code. terraform output -raw setup_claim_secret — never shown on the Amplify page."
}

output "avatar_bucket_name" {
  value = module.api.avatar_bucket_name
}

output "chat_function_name" {
  value = module.api.chat_function_name
}

output "warm_function_name" {
  value = module.api.warm_function_name
}

output "bedrock_lab_policy_arn" {
  value = module.bedrock_lab.managed_policy_arn
}
