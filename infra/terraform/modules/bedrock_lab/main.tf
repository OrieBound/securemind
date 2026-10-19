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

variable "create_dashboard" {
  type    = bool
  default = true
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_iam_policy" "bedrock_lab" {
  name        = "SecureMind-BedrockLab-${var.env_name}"
  description = "Least-privilege Bedrock invoke for SecureMind (attach to SSO permission set or IAM user)."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "InvokeFoundationModels"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:ListFoundationModels",
          "bedrock:GetFoundationModel",
          "bedrock:GetFoundationModelAvailability",
          "bedrock:ListInferenceProfiles",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_cloudwatch_dashboard" "bedrock" {
  count          = var.create_dashboard ? 1 : 0
  dashboard_name = "SecureMind-Bedrock-${var.env_name}"
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 2
        properties = {
          markdown = "## SecureMind Bedrock (${var.env_name})\nService metrics for Bedrock in `${data.aws_region.current.name}`. Prompt/response **content** logging is NOT enabled by this stack."
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 2
        width  = 12
        height = 6
        properties = {
          region = data.aws_region.current.name
          title  = "Bedrock Invocations"
          metrics = [
            ["AWS/Bedrock", "Invocations", { stat = "Sum" }],
          ]
          period = 300
          view   = "timeSeries"
        }
      },
    ]
  })
}

output "managed_policy_arn" {
  value = aws_iam_policy.bedrock_lab.arn
}
