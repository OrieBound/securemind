terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.25.0, < 7.0.0"
    }
  }
}

# Audit trail, alarms and a spend alert. Nothing here changes how the app runs.
#   * CloudTrail: one management-event trail (the first copy in an account has no charge).
#     Its log bucket is private, encrypted, versioned and expires objects after a year.
#   * Alarms: Lambda errors and throttles, API 5xx, an API 4xx spike (credential stuffing or a
#     flood), and DynamoDB throttling. They notify one SNS topic.
#   * Budget: a monthly cost alert, so a runaway model or request flood is noticed.
# Email subscriptions and budget notices need alert_email; without it the alarms still exist and
# can be read in the console.

variable "env_name" {
  type = string
}

variable "alert_email" {
  type        = string
  default     = ""
  description = "Where alarm and budget notices go. AWS sends a confirmation link first."
}

variable "monthly_budget_usd" {
  type        = number
  default     = 20
  description = "Monthly cost alert threshold in USD. 0 turns the budget off."
}

variable "enable_cloudtrail" {
  type    = bool
  default = true
}

variable "chat_function_name" {
  type = string
}

variable "rest_api_name" {
  type        = string
  description = "API Gateway REST API name (the ApiName dimension)."
}

variable "stage_name" {
  type    = string
  default = "prod"
}

variable "table_name" {
  type = string
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account = data.aws_caller_identity.current.account_id
  trail   = "securemind-${var.env_name}"
  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

# --- Notifications ---------------------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name = "securemind-alerts-${var.env_name}"
  tags = local.tags
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# --- Alarms ----------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "chat_errors" {
  alarm_name          = "securemind-${var.env_name}-chat-errors"
  alarm_description   = "The chat Lambda raised errors."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = var.chat_function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.tags
}

resource "aws_cloudwatch_metric_alarm" "chat_throttles" {
  alarm_name          = "securemind-${var.env_name}-chat-throttles"
  alarm_description   = "The chat Lambda was throttled (concurrency limit reached)."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = var.chat_function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.tags
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "securemind-${var.env_name}-api-5xx"
  alarm_description   = "API Gateway returned server errors."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5XXError"
  dimensions          = { ApiName = var.rest_api_name, Stage = var.stage_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.tags
}

# A burst of 4xx means failed sign-ins, probing, or throttling (429 counts as 4xx).
resource "aws_cloudwatch_metric_alarm" "api_4xx_spike" {
  alarm_name          = "securemind-${var.env_name}-api-4xx-spike"
  alarm_description   = "Many rejected API requests: possible flood, probing or token abuse."
  namespace           = "AWS/ApiGateway"
  metric_name         = "4XXError"
  dimensions          = { ApiName = var.rest_api_name, Stage = var.stage_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 100
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.tags
}

resource "aws_cloudwatch_metric_alarm" "dynamodb_throttles" {
  alarm_name          = "securemind-${var.env_name}-dynamodb-throttles"
  alarm_description   = "DynamoDB throttled requests on the fragments table."
  namespace           = "AWS/DynamoDB"
  metric_name         = "ThrottledRequests"
  dimensions          = { TableName = var.table_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.tags
}

# --- Budget ----------------------------------------------------------------------------------

resource "aws_budgets_budget" "monthly" {
  count        = var.monthly_budget_usd > 0 && var.alert_email != "" ? 1 : 0
  name         = "securemind-${var.env_name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}

# --- CloudTrail ------------------------------------------------------------------------------

resource "aws_s3_bucket" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = "securemind-trail-${local.account}-${var.env_name}"
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "trail" {
  count                   = var.enable_cloudtrail ? 1 : 0
  bucket                  = aws_s3_bucket.trail[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  rule {
    id     = "expire-after-a-year"
    status = "Enabled"
    filter {}
    expiration {
      days = 365
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
  depends_on = [aws_s3_bucket_versioning.trail]
}

data "aws_iam_policy_document" "trail_bucket" {
  count = var.enable_cloudtrail ? 1 : 0
  statement {
    sid       = "CloudTrailAclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.trail[0].arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:aws:cloudtrail:${data.aws_region.current.name}:${local.account}:trail/${local.trail}"]
    }
  }
  statement {
    sid       = "CloudTrailWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.trail[0].arn}/AWSLogs/${local.account}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:aws:cloudtrail:${data.aws_region.current.name}:${local.account}:trail/${local.trail}"]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.trail[0].arn, "${aws_s3_bucket.trail[0].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "trail" {
  count      = var.enable_cloudtrail ? 1 : 0
  bucket     = aws_s3_bucket.trail[0].id
  policy     = data.aws_iam_policy_document.trail_bucket[0].json
  depends_on = [aws_s3_bucket_public_access_block.trail]
}

resource "aws_cloudtrail" "this" {
  count                         = var.enable_cloudtrail ? 1 : 0
  name                          = local.trail
  s3_bucket_name                = aws_s3_bucket.trail[0].id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true
  tags                          = local.tags
  depends_on                    = [aws_s3_bucket_policy.trail]
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "trail_bucket" {
  value = var.enable_cloudtrail ? aws_s3_bucket.trail[0].id : ""
}
