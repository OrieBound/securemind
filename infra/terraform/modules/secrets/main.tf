terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.25.0, < 7.0.0"
    }
  }
}

# Stored values live in Systems Manager Parameter Store as SecureString parameters, encrypted
# with the AWS-managed key (alias/aws/ssm). Standard parameters have no monthly charge, where
# Secrets Manager charges $0.40 per secret. The table name is not a secret and is passed to the
# Lambda and Amplify as a plain setting, so it has no stored copy at all.

variable "env_name" {
  type = string
}

variable "groq_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

# Written by the app at runtime when an Admin pastes a key, so Terraform only creates it.
# Advanced tier (8 KB) so a long list of keys fits. It costs $0.05 a month.
resource "aws_ssm_parameter" "vendor_keys" {
  name        = "/securemind/${var.env_name}/vendor-keys"
  description = "Admin-pasted vendor API keys (Groq, Google, OpenAI, Anthropic). Not AWS credentials."
  type        = "SecureString"
  tier        = "Advanced"
  value       = jsonencode({ groqApiKey = null, extra = [] })

  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "groq" {
  count       = var.groq_api_key != "" ? 1 : 0
  name        = "/securemind/${var.env_name}/groq-api-key"
  description = "SecureMind bootstrap GROQ_API_KEY (optional)"
  type        = "SecureString"
  value       = var.groq_api_key

  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }

  lifecycle {
    ignore_changes = [value]
  }
}

output "groq_param_name" {
  value = var.groq_api_key != "" ? aws_ssm_parameter.groq[0].name : ""
}

output "groq_param_arn" {
  value = var.groq_api_key != "" ? aws_ssm_parameter.groq[0].arn : ""
}

output "vendor_keys_param_name" {
  value = aws_ssm_parameter.vendor_keys.name
}

output "vendor_keys_param_arn" {
  value = aws_ssm_parameter.vendor_keys.arn
}
