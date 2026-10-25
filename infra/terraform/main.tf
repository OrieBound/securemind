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

# CloudFront only reads certificates from us-east-1, wherever the rest of the stack runs.
provider "aws" {
  alias  = "cloudfront_cert"
  region = "us-east-1"
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

variable "permissions_boundary_arn" {
  type        = string
  default     = ""
  description = "Permission boundary for the roles this stack creates. Set it when applying from CI; the bootstrap prints it."
}

variable "access_contact_url" {
  type        = string
  default     = ""
  description = "Optional page that says how to ask for an invitation. Shown on the sign-in screen of this install."
}

variable "create_bedrock_dashboard" {
  type    = bool
  default = true
}

variable "cognito_deletion_protection" {
  type        = string
  default     = "ACTIVE"
  description = "Deleting the user pool deletes every user, so this is on by default. Set INACTIVE only for a sandbox you tear down."
}

variable "alert_email" {
  type        = string
  default     = ""
  description = "Receives alarm and budget notices (AWS sends a confirmation link first). Empty still creates the alarms."
}

variable "monthly_budget_usd" {
  type        = number
  default     = 5
  description = "Monthly cost alert in USD (needs alert_email). 0 turns the budget off."
}

variable "enable_monitoring" {
  type        = bool
  default     = true
  description = "Alarms, budget and CloudTrail (modules/monitoring). Needs the bootstrap stack applied with the monitoring permissions."
}

variable "enable_cloudtrail" {
  type        = bool
  default     = true
  description = "One multi-region management-event trail. Set false if the account already has an organization trail."
}

variable "enable_api_access_logs" {
  type        = bool
  default     = false
  description = "API Gateway stage access logs. Needs the account-level API Gateway CloudWatch role to be set once per account/region."
}

variable "auth_mode" {
  type    = string
  default = "cognito"
}

# --- Custom domain (off by default; see modules/domain) -------------------------------------
variable "domain_name" {
  type        = string
  default     = ""
  description = "Apex domain you own, such as example.com. Empty keeps everything on the Amplify and API Gateway addresses."
}

variable "enable_custom_domains" {
  type        = bool
  default     = false
  description = "Stage 2 of the domain setup. Turn on only after your registrar's nameservers point at the Route53 zone."
}

variable "app_subdomain" {
  type    = string
  default = "app"
}

variable "api_subdomain" {
  type        = string
  default     = ""
  description = "Serve the chat API at this subdomain. Empty keeps the execute-api address."
}

variable "extra_dns_records" {
  type = map(object({
    type   = string
    ttl    = optional(number, 300)
    values = optional(list(string), [])
    alias = optional(object({
      name    = string
      zone_id = string
    }))
  }))
  default     = {}
  description = "Records for sites hosted elsewhere (marketing site, demo). Key is the host without the domain, or @ for the apex."
}

locals {
  # Known from variables alone, so nothing here depends on a resource that is not built yet.
  custom_domains = var.domain_name != "" && var.enable_custom_domains
  app_url        = local.custom_domains ? "https://${var.app_subdomain}.${var.domain_name}" : ""
  api_public_url = local.custom_domains && var.api_subdomain != "" ? "https://${var.api_subdomain}.${var.domain_name}" : module.api.api_base_url
  allowed_origin = local.app_url != "" ? local.app_url : var.allowed_origin
  # Sign-in addresses: localhost, the custom domain when there is one, and the address in
  # allowed_origin (Amplify's own, until the domain is live). Keeping the last one here means a
  # plain apply never drops what `npm run infra:wire` added.
  login_origins = distinct(compact([local.app_url, var.allowed_origin == "http://localhost:3000" ? "" : trimsuffix(var.allowed_origin, "/")]))
  login_urls    = concat(["http://localhost:3000/", "http://localhost:3000/login"], flatten([for o in local.login_origins : ["${o}/", "${o}/login"]]))

  chat_zip           = "${path.module}/.build/lambda/chat.zip"
  warm_zip           = "${path.module}/.build/lambda/warm.zip"
  avatar_bucket_name = "securemind-avatars-${var.env_name}-${data.aws_caller_identity.current.account_id}"
}

data "aws_caller_identity" "current" {}

module "bedrock_lab" {
  source           = "./modules/bedrock_lab"
  env_name         = var.env_name
  create_dashboard = var.create_bedrock_dashboard
}

module "auth_cognito" {
  source              = "./modules/auth_cognito"
  env_name            = var.env_name
  create_domain       = var.create_cognito_domain
  deletion_protection = var.cognito_deletion_protection
  callback_urls       = local.login_urls
  logout_urls         = local.login_urls
}

module "data_dynamodb" {
  source           = "./modules/data_dynamodb"
  env_name         = var.env_name
  embed_dimensions = var.embed_dimensions
}

module "monitoring" {
  count              = var.enable_monitoring ? 1 : 0
  source             = "./modules/monitoring"
  env_name           = var.env_name
  alert_email        = var.alert_email
  monthly_budget_usd = var.monthly_budget_usd
  enable_cloudtrail  = var.enable_cloudtrail
  chat_function_name = module.api.chat_function_name
  rest_api_name      = "securemind-api-${var.env_name}"
  table_name         = module.data_dynamodb.table_name
}

module "secrets" {
  source       = "./modules/secrets"
  env_name     = var.env_name
  groq_api_key = var.groq_api_key
}

module "api" {
  source                   = "./modules/api"
  permissions_boundary_arn = var.permissions_boundary_arn
  env_name                 = var.env_name
  allowed_origin           = local.allowed_origin
  chat_zip_path            = local.chat_zip
  warm_zip_path            = local.warm_zip
  fragments_table_name     = module.data_dynamodb.table_name
  fragments_table_arn      = module.data_dynamodb.table_arn
  groq_param_name          = module.secrets.groq_param_name
  groq_param_arn           = module.secrets.groq_param_arn
  vendor_keys_param_name   = module.secrets.vendor_keys_param_name
  vendor_keys_param_arn    = module.secrets.vendor_keys_param_arn
  auth_mode                = var.auth_mode
  cognito_user_pool_id     = module.auth_cognito.user_pool_id
  cognito_user_pool_arn    = module.auth_cognito.user_pool_arn
  cognito_client_id        = module.auth_cognito.client_id
  cognito_region           = var.aws_region
  cognito_issuer           = module.auth_cognito.issuer
  embed_dimensions         = tostring(var.embed_dimensions)
  avatar_bucket_name       = local.avatar_bucket_name
  enable_access_logs       = var.enable_api_access_logs
}

module "amplify" {
  source                   = "./modules/amplify"
  env_name                 = var.env_name
  api_base_url             = local.api_public_url
  cognito_user_pool_id     = module.auth_cognito.user_pool_id
  cognito_user_pool_arn    = module.auth_cognito.user_pool_arn
  cognito_client_id        = module.auth_cognito.client_id
  cognito_region           = var.aws_region
  cognito_issuer           = module.auth_cognito.issuer
  auth_mode                = var.auth_mode
  branch_name              = var.amplify_branch
  fragments_table_name     = module.data_dynamodb.table_name
  fragments_table_arn      = module.data_dynamodb.table_arn
  vendor_keys_param_name   = module.secrets.vendor_keys_param_name
  vendor_keys_param_arn    = module.secrets.vendor_keys_param_arn
  access_contact_url       = var.access_contact_url
  permissions_boundary_arn = var.permissions_boundary_arn
  avatar_s3_bucket_name    = local.avatar_bucket_name

  # Live voice captions straight from the browser to Amazon Transcribe, in the same region as the app.
  transcribe_stream_region = var.aws_region
}

# Custom domain. Needs the Amplify app and the API to exist, and never feeds back into them
# except through the plain variables above, so there is no dependency cycle.
module "domain" {
  source                = "./modules/domain"
  env_name              = var.env_name
  domain_name           = var.domain_name
  enable_custom_domains = var.enable_custom_domains
  app_subdomain         = var.app_subdomain
  api_subdomain         = var.api_subdomain
  amplify_app_id        = module.amplify.app_id
  amplify_branch        = var.amplify_branch
  api_rest_api_id       = module.api.rest_api_id
  extra_records         = var.extra_dns_records
}

# Static websites (marketing, demo): S3 + CloudFront + certificate + a GitHub deploy role each.
# Empty by default, so nothing is built. Needs domain_name, because the records go in that zone.
variable "static_sites" {
  type = map(object({
    aliases                  = list(string)
    redirect_others_to_first = optional(bool, false)
    github_subject_prefix    = string
    github_branch            = optional(string, "main")
    enabled                  = optional(bool, true)
    existing = optional(object({
      bucket_name   = optional(string)
      role_name     = optional(string)
      function_name = optional(string)
      oac_name      = optional(string)
    }), {})
  }))
  default     = {}
  description = "Static sites to host, keyed by a short name. See domain.tfvars.example."
}

data "aws_iam_openid_connect_provider" "github" {
  count = length(var.static_sites) > 0 ? 1 : 0
  url   = "https://token.actions.githubusercontent.com"
}

module "static_site" {
  for_each = var.static_sites
  source   = "./modules/static_site"
  providers = {
    aws                 = aws
    aws.cloudfront_cert = aws.cloudfront_cert
  }

  name                     = each.key
  env_name                 = var.env_name
  zone_id                  = module.domain.zone_id
  aliases                  = each.value.aliases
  redirect_others_to_first = each.value.redirect_others_to_first
  github_subject_prefix    = each.value.github_subject_prefix
  github_branch            = each.value.github_branch
  enabled                  = each.value.enabled
  existing                 = each.value.existing
  oidc_provider_arn        = data.aws_iam_openid_connect_provider.github[0].arn
}

output "static_sites" {
  description = "Per site: the values to copy into that repository's GitHub Actions variables."
  value = {
    for k, m in module.static_site : k => {
      url             = m.site_url
      s3_bucket       = m.bucket_name
      distribution_id = m.distribution_id
      role_arn        = m.deploy_role_arn
    }
  }
}

output "api_base_url" {
  value       = module.api.api_base_url
  description = "The execute-api address. Always works, custom domain or not."
}

output "api_public_url" {
  value       = local.api_public_url
  description = "The API address the browser uses: the custom domain once enabled, otherwise api_base_url."
}

output "app_url" {
  value       = module.domain.app_url
  description = "Custom app URL once stage 2 is on. Empty before that."
}

output "route53_name_servers" {
  value       = module.domain.name_servers
  description = "Set these as the custom nameservers at your registrar (stage 1)."
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
