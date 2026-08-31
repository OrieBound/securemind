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

variable "fragments_table_name" {
  type = string
}

variable "groq_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

resource "aws_secretsmanager_secret" "fragments" {
  name                    = "securemind/${var.env_name}/fragments-table"
  description             = "SecureMind DynamoDB fragments table name (ADR 0007)"
  recovery_window_in_days = 7
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

resource "aws_secretsmanager_secret_version" "fragments" {
  secret_id     = aws_secretsmanager_secret.fragments.id
  secret_string = var.fragments_table_name

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "vendor_keys" {
  name                    = "securemind/${var.env_name}/vendor-keys"
  description             = "Admin-pasted vendor API keys (Groq, Google, OpenAI, Anthropic). Not AWS credentials."
  recovery_window_in_days = 7
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

resource "aws_secretsmanager_secret_version" "vendor_keys" {
  secret_id     = aws_secretsmanager_secret.vendor_keys.id
  secret_string = jsonencode({ groqApiKey = null, extra = [] })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "groq" {
  count                   = var.groq_api_key != "" ? 1 : 0
  name                    = "securemind/${var.env_name}/groq-api-key"
  description             = "SecureMind bootstrap GROQ_API_KEY (optional)"
  recovery_window_in_days = 7
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

resource "aws_secretsmanager_secret_version" "groq" {
  count         = var.groq_api_key != "" ? 1 : 0
  secret_id     = aws_secretsmanager_secret.groq[0].id
  secret_string = var.groq_api_key

  lifecycle {
    ignore_changes = [secret_string]
  }
}

output "fragments_table_secret_arn" {
  value = aws_secretsmanager_secret.fragments.arn
}

output "groq_secret_arn" {
  value = var.groq_api_key != "" ? aws_secretsmanager_secret.groq[0].arn : ""
}

output "vendor_keys_secret_arn" {
  value = aws_secretsmanager_secret.vendor_keys.arn
}
