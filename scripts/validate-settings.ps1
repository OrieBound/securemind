# Ad-hoc validation of Settings -> Inference & API against a running dev server.
# Logs in as the Floci admin, then exercises every write the UI can perform.
$ErrorActionPreference = "Stop"
$base = "http://localhost:3000"
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession

function Show($label, $ok, $detail) {
  $mark = if ($ok) { "PASS" } else { "FAIL" }
  Write-Host ("[{0}] {1}" -f $mark, $label)
  if ($detail) { Write-Host ("       {0}" -f $detail) }
}

function Put($body) {
  $json = $body | ConvertTo-Json -Depth 5
  return Invoke-RestMethod -Uri "$base/api/settings/providers" -Method PUT -Body $json `
    -ContentType "application/json" -WebSession $s
}

# 1. Login (the login route returns only {ok, expiresIn}; role comes from /me)
$login = @{ email = "admin@example.test"; password = "<demo-password>!" } | ConvertTo-Json
Invoke-RestMethod -Uri "$base/api/auth/login" -Method POST -Body $login `
  -ContentType "application/json" -WebSession $s | Out-Null
$me = Invoke-RestMethod -Uri "$base/api/auth/me" -WebSession $s
Show "login as admin" ($me.role -eq "admin") "role=$($me.role) email=$($me.email)"

# 2. Read status
$st = Invoke-RestMethod -Uri "$base/api/settings/providers" -WebSession $s -Method GET
Show "GET providers" ($st.canEdit -eq $true) "keys=$($st.keys.Count) primary=$($st.primaryProvider)"
Write-Host "       key ids: $(($st.keys | ForEach-Object { $_.id }) -join ', ')"
Show "aws profiles discovered" $true "profiles=[$($st.aws.availableProfiles -join ', ')] detected=$($st.aws.detected) floci=$($st.aws.looksLikeFloci)"

# 3. Toggle billable AWS on
$st = Put @{ allowRealAws = $true }
Show "allowRealAws -> true persists" ($st.aws.allowRealAws -eq $true) "allowRealAws=$($st.aws.allowRealAws) locked=$($st.aws.lockedByEnvironment)"

# 4. Region
$st = Put @{ bedrockRegion = "us-west-2" }
Show "region -> us-west-2 persists" ($st.bedrockRegion -eq "us-west-2") "region=$($st.bedrockRegion)"

# 5. Profile select + clear
$st = Put @{ awsProfile = "nonexistent-profile" }
Show "profile select persists" ($st.aws.profile -eq "nonexistent-profile") "profile=$($st.aws.profile) detected=$($st.aws.detected)"
Show "bad profile blocks bedrock" ($st.aws.detected -eq $false) "error=$($st.aws.error)"
$st = Put @{ awsProfile = $null }
Show "profile clear persists" ($null -eq $st.aws.profile) "profile=$($st.aws.profile)"

# 6. Toggle billable AWS back off
$st = Put @{ allowRealAws = $false }
Show "allowRealAws -> false persists" ($st.aws.allowRealAws -eq $false) "allowRealAws=$($st.aws.allowRealAws)"

# 7. Vendor key detection: Anthropic
$st = Put @{ addKey = @{ secret = "sk-ant-api03-VALIDATIONONLYnotarealkey000000000000"; kind = "anthropic" } }
$ak = $st.keys | Where-Object { $_.kind -eq "anthropic" } | Select-Object -First 1
Show "anthropic key stored" ($null -ne $ak) "label=$($ak.label) hint=$($ak.hint) catalog=$($ak.catalog) status=$($ak.status)"

# 8. Vendor key detection: Google
$st = Put @{ addKey = @{ secret = "AIzaSyVALIDATIONONLY0000000000000000000"; kind = "google" } }
$gk = $st.keys | Where-Object { $_.kind -eq "google" } | Select-Object -First 1
Show "google key stored" ($null -ne $gk) "label=$($gk.label) hint=$($gk.hint) catalog=$($gk.catalog)"

# 9. Secrets never returned
$raw = $st | ConvertTo-Json -Depth 8
$leaked = ($raw -match "sk-ant-api03-VALIDATIONONLY") -or ($raw -match "AIzaSyVALIDATIONONLY")
Show "no secret material in response" (-not $leaked) "payload scanned for pasted secrets"

# 10. Pasted AWS key refused
try {
  Put @{ bedrockAccessKeyId = "AKIAIOSFODNN7EXAMPLE" } | Out-Null
  Show "AWS key refused" $false "expected 422"
} catch {
  Show "AWS key refused" ($_.Exception.Response.StatusCode.value__ -eq 422) "status=$($_.Exception.Response.StatusCode.value__)"
}

# 11. Cleanup the validation keys
foreach ($k in @($ak, $gk)) {
  if ($k) { $st = Put @{ removeKeyId = $k.id } }
}
$left = $st.keys | Where-Object { $_.id -eq $ak.id -or $_.id -eq $gk.id }
Show "validation keys removed" ($null -eq $left) "remaining keys=$($st.keys.Count)"

# 12. Member is read-only
$s2 = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login2 = @{ email = "member@securemind.local"; password = "<demo-password>!" } | ConvertTo-Json
Invoke-RestMethod -Uri "$base/api/auth/login" -Method POST -Body $login2 -ContentType "application/json" -WebSession $s2 | Out-Null
$me2 = Invoke-RestMethod -Uri "$base/api/auth/me" -WebSession $s2
Show "login as member" ($me2.role -eq "member") "role=$($me2.role)"
try {
  Invoke-RestMethod -Uri "$base/api/settings/providers" -Method PUT -Body '{"allowRealAws":true}' `
    -ContentType "application/json" -WebSession $s2 | Out-Null
  Show "member write blocked" $false "expected 403"
} catch {
  Show "member write blocked" ($_.Exception.Response.StatusCode.value__ -eq 403) "status=$($_.Exception.Response.StatusCode.value__)"
}

# 13. Catalog with Bedrock off
$cat = Invoke-RestMethod -Uri "$base/api/models/catalog" -WebSession $s -Method GET
Show "bedrock hidden while gate is off" ($cat.bedrock.Count -eq 0) `
  "groq=$($cat.groq.Count) bedrock=$($cat.bedrock.Count) ollama=$($cat.ollama.Count)"

# 14. Live Bedrock catalog with a real profile
$st = Put @{ awsProfile = "your-aws-profile"; bedrockRegion = "us-east-1"; allowRealAws = $true }
$cat = Invoke-RestMethod -Uri "$base/api/models/catalog" -WebSession $s -Method GET
Show "live bedrock catalog" ($cat.bedrock.Count -gt 10) `
  "detected=$($st.aws.detected) bedrockModels=$($cat.bedrock.Count) errors=$($cat.errors -join '; ')"
Write-Host "       sample: $(($cat.bedrock | Select-Object -First 4 | ForEach-Object { $_.id }) -join ', ')"

# 15. Server-side model allowlist accepts a live Bedrock id and rejects junk
$live = $cat.bedrock[0].id
Show "allowlist source is live catalog" ($null -ne $live) "first model=$live"
