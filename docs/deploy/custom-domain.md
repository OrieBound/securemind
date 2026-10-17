# Custom domain (Namecheap registrar, Route53 DNS)

This puts the hosted edition on your own domain. The registrar stays where it is. Only the domain's **nameservers** change, so Route53 answers for it.

Example names, for a domain called `example.com`:

| Name | What it serves | Where it lives |
|---|---|---|
| `example.com` and `www` | marketing site | its own hosting, added with `extra_dns_records` |
| `app.example.com` | your SecureMind (private, sign-in) | this stack: Amplify |
| `sample.example.com` | public demo | its own hosting, added with `extra_dns_records` |
| `api.example.com` | chat API (optional) | this stack: API Gateway |

Everything is off until you set `domain_name`, and the parts that need working DNS wait for a second switch. A half-finished setup cannot break a running install.

## Before you start

**Write down every DNS record the domain has at the registrar** (Namecheap: Domain List, Manage, Advanced DNS). Once the nameservers move, those records stop being used. Mail (MX, SPF, DKIM), verification TXT records and anything else you rely on must be recreated in Route53, using `extra_dns_records` below.

Cost: a Route53 hosted zone is about $0.50 a month plus a few cents per million lookups. Certificates and the API Gateway custom domain are free.

## Stage 1: create the zone

Create `infra/terraform/domain.auto.tfvars` (it is ignored by git) from `domain.tfvars.example`:

```hcl
domain_name = "example.com"
```

Apply, and then read the nameservers:

```bash
terraform -chdir=infra/terraform apply
terraform -chdir=infra/terraform output route53_name_servers
```

At Namecheap: Domain List, **Manage**, Nameservers, choose **Custom DNS**, and enter the four values Terraform printed. Save. This usually takes minutes and can take up to 48 hours. Check it with:

```bash
nslookup -type=NS example.com
```

Wait until it lists the four `awsdns` servers. **Do not go to stage 2 before it does**: certificates cannot validate until DNS answers from Route53.

## Stage 2: turn the domain on

Add to the same file:

```hcl
enable_custom_domains = true
api_subdomain         = "api"   # optional; leave out to keep the execute-api address
```

Then, in this order:

```bash
terraform -chdir=infra/terraform apply
npm run infra:wire        # always straight after an apply
```

and **deploy the app again** (push to `main`, or start an Amplify job). The deploy matters: the browser's allowed connections and the API address are fixed when the app is built.

What this sets up:

- **The app** at `app.example.com`, with an Amplify-managed certificate. The records Amplify asks for are added to the zone for you.
- **The API** (if `api_subdomain` is set) at `api.example.com`, with its own certificate and a regional API Gateway domain mapped to the `prod` stage.
- **Cross-origin and sign-in settings**: the chat API's allowed origin becomes `https://app.example.com`, the Cognito sign-in and sign-out URLs gain it (the localhost entries stay), and the Amplify app's `NEXT_PUBLIC_API_BASE_URL` becomes the API domain. `infra:wire` keeps any earlier entries, so nothing is dropped.

Check it:

```bash
curl -sI https://app.example.com | grep -i -E "^(HTTP|content-security|strict-transport)"
```

then open `https://app.example.com`, sign in, and send a chat message.

## Marketing site, demo and other records

Anything hosted elsewhere goes in `extra_dns_records`. The key is the host name without the domain, or `@` for the apex. To put two record types on the same name, add a suffix after a slash, such as `@/MX`.

```hcl
extra_dns_records = {
  # Marketing site on CloudFront: the apex needs an alias, not a CNAME.
  "@"      = { type = "A", alias = { name = "d111111abcdef8.cloudfront.net", zone_id = "Z2FDTNDATAQYW2" } }
  "www"    = { type = "CNAME", values = ["d111111abcdef8.cloudfront.net"] }

  # Demo site on CloudFront.
  "sample" = { type = "A", alias = { name = "d222222abcdef8.cloudfront.net", zone_id = "Z2FDTNDATAQYW2" } }

  # Records copied over from the registrar. "@/MX" sits beside the "@" alias above.
  "@/MX"   = { type = "MX", values = ["10 mail.example.net."] }
}
```

`Z2FDTNDATAQYW2` is the fixed zone id for every CloudFront distribution. Each CloudFront site also needs a certificate in `us-east-1`; add its validation CNAME here too.

## Rolling back

Setting `enable_custom_domains = false` and applying removes the domain resources and puts the app back on its Amplify and API Gateway addresses. Run `infra:wire` and deploy again. The Route53 zone stays, so the registrar does not need to change.

## Things to know

- **After stage 2 the chat API accepts one origin**: the custom domain. The old `*.amplifyapp.com` address will load the page but chat calls from it will be refused. Use the custom address.
- **HTTPS only.** HSTS is sent on the hosted edition, so browsers will not go back to plain HTTP for the domain.
- **Nothing here has been applied to a real account yet.** It is validated with `terraform validate` and covered by static tests. Read the plan before the first apply.
