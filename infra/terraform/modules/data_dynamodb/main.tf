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
  type        = string
  description = "Suffix for resource names (sandbox, lab, …)."
}

variable "embed_dimensions" {
  type        = number
  description = "Locked at table create. 1024 = Bedrock Titan v2 (hosted default)."
  default     = 1024
  validation {
    condition     = contains([768, 1024], var.embed_dimensions)
    error_message = "embed_dimensions must be 768 or 1024."
  }
}

resource "aws_cloudformation_stack" "fragments" {
  name          = "securemind-dynamodb-${var.env_name}"
  template_body = file("${path.module}/fragments.cfn.yaml")
  parameters = {
    EnvName         = var.env_name
    EmbedDimensions = tostring(var.embed_dimensions)
  }
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

output "table_name" {
  value = aws_cloudformation_stack.fragments.outputs.FragmentsTableName
}

output "table_arn" {
  value = aws_cloudformation_stack.fragments.outputs.FragmentsTableArn
}

output "vector_index_name" {
  value = "workspace-vectors"
}
