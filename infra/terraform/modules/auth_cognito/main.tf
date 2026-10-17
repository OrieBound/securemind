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

variable "callback_urls" {
  type    = list(string)
  default = ["http://localhost:3000/", "http://localhost:3000/login"]
}

variable "logout_urls" {
  type    = list(string)
  default = ["http://localhost:3000/", "http://localhost:3000/login"]
}

variable "create_domain" {
  type    = bool
  default = false
}

# Authenticator-app codes (TOTP). OPTIONAL lets each person turn it on for their own account,
# which the app does under My Profile, without forcing anyone and without locking anyone out.
# Use "ON" only after every user has enrolled, and note the app's own sign-in handles the
# code step for either setting. SMS is deliberately not offered: it needs SNS and is weaker.
variable "mfa_configuration" {
  type        = string
  default     = "OPTIONAL"
  description = "OFF, OPTIONAL or ON. Authenticator-app (software token) codes only."

  validation {
    condition     = contains(["OFF", "OPTIONAL", "ON"], var.mfa_configuration)
    error_message = "mfa_configuration must be OFF, OPTIONAL or ON."
  }
}

# Deleting a pool deletes every user. ACTIVE makes Terraform and the console refuse until it is
# switched off. Left INACTIVE by default so sandbox teardown still works; set ACTIVE in production.
variable "deletion_protection" {
  type        = string
  default     = "INACTIVE"
  description = "ACTIVE or INACTIVE."

  validation {
    condition     = contains(["ACTIVE", "INACTIVE"], var.deletion_protection)
    error_message = "deletion_protection must be ACTIVE or INACTIVE."
  }
}

resource "aws_cognito_user_pool" "this" {
  name = "securemind-${var.env_name}"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = var.mfa_configuration
  deletion_protection      = var.deletion_protection

  dynamic "software_token_mfa_configuration" {
    for_each = var.mfa_configuration == "OFF" ? [] : [1]
    content {
      enabled = true
    }
  }

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
    invite_message_template {
      email_subject = "Your SecureMind invite"
      email_message = "You have been invited to SecureMind. Username: {username} Temporary password: {####}"
      sms_message   = "SecureMind invite {username} password {####}"
    }
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
  }

  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

resource "aws_cognito_user_pool_client" "this" {
  name         = "securemind-web-${var.env_name}"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret                      = false
  prevent_user_existence_errors        = "ENABLED"
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.callback_urls
  logout_urls                          = var.logout_urls
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_group" "owner" {
  user_pool_id = aws_cognito_user_pool.this.id
  name         = "Owner"
  description  = "SecureMind instance Owner (first-run claim / Super Admin)"
  precedence   = 0
}

resource "aws_cognito_user_group" "admin" {
  user_pool_id = aws_cognito_user_pool.this.id
  name         = "Admin"
  description  = "SecureMind administrators (providers, users)"
  precedence   = 1
}

resource "aws_cognito_user_group" "member" {
  user_pool_id = aws_cognito_user_pool.this.id
  name         = "Member"
  description  = "Ordinary SecureMind users"
  precedence   = 10
}

resource "aws_cognito_user_pool_domain" "this" {
  count        = var.create_domain ? 1 : 0
  domain       = "securemind-${var.env_name}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.this.id
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "client_id" {
  value = aws_cognito_user_pool_client.this.id
}

output "issuer" {
  value = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.this.id}"
}

output "hosted_ui_domain" {
  value = var.create_domain ? "https://${aws_cognito_user_pool_domain.this[0].domain}.auth.${data.aws_region.current.name}.amazoncognito.com" : ""
}
