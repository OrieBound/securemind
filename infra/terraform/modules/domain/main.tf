# Custom domain for the hosted edition: a Route53 zone, the app on its own subdomain, and
# optionally the chat API on one.
#
# Everything here is OFF until `domain_name` is set, and the parts that need working DNS wait
# for a second switch, so a half-finished domain can never break a running install.
#
#   Stage 1  domain_name = "example.com"           creates only the Route53 zone.
#            Take the name_servers output to your registrar and wait for them to take effect.
#   Stage 2  enable_custom_domains = true           adds the Amplify app domain (certificate
#            included) and, if api_subdomain is set, the API domain with its own certificate.
#
# The registrar can stay where it is. Only its nameservers change.

terraform {
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

variable "domain_name" {
  type        = string
  default     = ""
  description = "Apex domain you own, e.g. example.com. Empty turns this module off."
}

variable "enable_custom_domains" {
  type        = bool
  default     = false
  description = "Stage 2. Set only after the registrar's nameservers point at the Route53 zone."
}

variable "app_subdomain" {
  type        = string
  default     = "app"
  description = "The app is served at <app_subdomain>.<domain_name>."
}

variable "api_subdomain" {
  type        = string
  default     = ""
  description = "Serve the chat API at <api_subdomain>.<domain_name>. Empty keeps the execute-api address."
}

variable "amplify_app_id" {
  type = string
}

variable "amplify_branch" {
  type    = string
  default = "main"
}

variable "api_rest_api_id" {
  type = string
}

variable "api_stage_name" {
  type    = string
  default = "prod"
}

# Records for things hosted elsewhere, such as a marketing site or a demo. Keys are the host
# name without the domain ("www", "sample"), or "@" for the apex. To put two record types on one
# name, add a suffix after a slash: "@" for the A alias and "@/MX" for the mail record.
variable "extra_records" {
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
  description = "Extra DNS records. Use alias for CloudFront or other AWS targets, values for CNAME, TXT and MX."
}

locals {
  zone_enabled = var.domain_name != ""
  custom       = local.zone_enabled && var.enable_custom_domains
  api_custom   = local.custom && var.api_subdomain != ""
  app_host     = "${var.app_subdomain}.${var.domain_name}"
  api_host     = "${var.api_subdomain}.${var.domain_name}"

  tags = {
    Project = "SecureMind"
    Env     = var.env_name
  }
}

resource "aws_route53_zone" "this" {
  count   = local.zone_enabled ? 1 : 0
  name    = var.domain_name
  comment = "SecureMind ${var.env_name}"
  tags    = local.tags
}

# --- The app on <app_subdomain>.<domain_name> --------------------------------------------------

resource "aws_amplify_domain_association" "app" {
  count                 = local.custom ? 1 : 0
  app_id                = var.amplify_app_id
  domain_name           = var.domain_name
  wait_for_verification = false

  sub_domain {
    branch_name = var.amplify_branch
    prefix      = var.app_subdomain
  }
}

# Amplify hands back the records it needs as text ("name CNAME value"). allow_overwrite keeps
# this safe if Amplify has already added them to the zone itself.
locals {
  amplify_cert_parts = local.custom ? regex(
    "^(\\S+)\\s+CNAME\\s+(\\S+)$",
    trimspace(aws_amplify_domain_association.app[0].certificate_verification_dns_record),
  ) : []
  amplify_site_parts = local.custom ? regex(
    "^(\\S*)\\s+CNAME\\s+(\\S+)$",
    trimspace(tolist(aws_amplify_domain_association.app[0].sub_domain)[0].dns_record),
  ) : []
}

resource "aws_route53_record" "amplify_certificate" {
  count           = local.custom ? 1 : 0
  zone_id         = aws_route53_zone.this[0].zone_id
  name            = local.amplify_cert_parts[0]
  type            = "CNAME"
  ttl             = 300
  records         = [local.amplify_cert_parts[1]]
  allow_overwrite = true
}

resource "aws_route53_record" "amplify_site" {
  count           = local.custom ? 1 : 0
  zone_id         = aws_route53_zone.this[0].zone_id
  name            = local.app_host
  type            = "CNAME"
  ttl             = 300
  records         = [local.amplify_site_parts[1]]
  allow_overwrite = true
}

# --- The chat API on <api_subdomain>.<domain_name> ---------------------------------------------

resource "aws_acm_certificate" "api" {
  count             = local.api_custom ? 1 : 0
  domain_name       = local.api_host
  validation_method = "DNS"
  tags              = local.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "api_certificate" {
  for_each = local.api_custom ? {
    for o in aws_acm_certificate.api[0].domain_validation_options : o.domain_name => {
      name   = o.resource_record_name
      type   = o.resource_record_type
      record = o.resource_record_value
    }
  } : {}

  zone_id         = aws_route53_zone.this[0].zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "api" {
  count                   = local.api_custom ? 1 : 0
  certificate_arn         = aws_acm_certificate.api[0].arn
  validation_record_fqdns = [for r in aws_route53_record.api_certificate : r.fqdn]
}

resource "aws_api_gateway_domain_name" "api" {
  count                    = local.api_custom ? 1 : 0
  domain_name              = local.api_host
  regional_certificate_arn = aws_acm_certificate_validation.api[0].certificate_arn
  security_policy          = "TLS_1_2"
  tags                     = local.tags

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_base_path_mapping" "api" {
  count       = local.api_custom ? 1 : 0
  api_id      = var.api_rest_api_id
  stage_name  = var.api_stage_name
  domain_name = aws_api_gateway_domain_name.api[0].domain_name
}

resource "aws_route53_record" "api_alias" {
  count   = local.api_custom ? 1 : 0
  zone_id = aws_route53_zone.this[0].zone_id
  name    = local.api_host
  type    = "A"

  alias {
    name                   = aws_api_gateway_domain_name.api[0].regional_domain_name
    zone_id                = aws_api_gateway_domain_name.api[0].regional_zone_id
    evaluate_target_health = false
  }
}

# --- Records for things hosted elsewhere -------------------------------------------------------

resource "aws_route53_record" "extra" {
  for_each = local.zone_enabled ? var.extra_records : {}

  zone_id         = aws_route53_zone.this[0].zone_id
  name            = split("/", each.key)[0] == "@" ? var.domain_name : "${split("/", each.key)[0]}.${var.domain_name}"
  type            = each.value.type
  ttl             = each.value.alias == null ? each.value.ttl : null
  records         = each.value.alias == null ? each.value.values : null
  allow_overwrite = true

  dynamic "alias" {
    for_each = each.value.alias == null ? [] : [each.value.alias]
    content {
      name                   = alias.value.name
      zone_id                = alias.value.zone_id
      evaluate_target_health = false
    }
  }
}

output "name_servers" {
  value       = local.zone_enabled ? aws_route53_zone.this[0].name_servers : []
  description = "Set these as the custom nameservers at your registrar."
}

output "zone_id" {
  value = local.zone_enabled ? aws_route53_zone.this[0].zone_id : ""
}

output "app_url" {
  value       = local.custom ? "https://${local.app_host}" : ""
  description = "Public app URL once stage 2 is on. Empty before that."
}

output "api_url" {
  value       = local.api_custom ? "https://${local.api_host}" : ""
  description = "Public chat API URL once the API domain is on. Empty before that."
}
