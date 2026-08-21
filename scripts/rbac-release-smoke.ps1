<#
.SYNOPSIS
  RBAC, approval-policy, and workflow smoke tests for Wudox CRM.

.DESCRIPTION
  Hits the live API (default http://localhost:3001) to verify roles, permissions,
  approval configuration, multi-agency isolation, and workflow E2E paths. Safe to re-run
  before releases; E2E steps create test clients per agency when enabled.

  Prerequisites:
    - Backend running with seeded data (npm run prisma:seed, prisma:seed-rbac, prisma:seed-approval)
    - Demo users from seed.ts (password123 except Super Admin)

.PARAMETER ApiBase
  API origin without trailing slash (default http://localhost:3001).

.PARAMETER SuperAdminPassword
  Password for hassan@wudox.com (or override via SUPER_ADMIN_INITIAL_PASSWORD in .env).

.PARAMETER DemoPassword
  Shared password for seeded demo users (default password123).

.PARAMETER EmailDomain
  Domain of the demo user accounts in the target environment (default wudox.ca).
  Environments provisioned before the Wudox rebrand may still have accounts under
  the previous domain — pass it here to match. Note: the local seed creates only
  one agency, so the Vancouver multi-agency tests skip on freshly seeded databases;
  they require an environment with both Toronto and Vancouver agencies.

.PARAMETER SkipE2E
  Skip mutating workflow tests (client add chain, lead request, DB manager add).

.EXAMPLE
  .\scripts\rbac-release-smoke.ps1

.EXAMPLE
  .\scripts\rbac-release-smoke.ps1 -ApiBase "https://api.example.com" -SuperAdminPassword "secret"

.EXAMPLE
  .\scripts\rbac-release-smoke.ps1 -SkipE2E
#>
[CmdletBinding()]
param(
  [string]$ApiBase = "http://localhost:3001",
  [string]$SuperAdminEmail = "hassan@wudox.com",
  [string]$SuperAdminPassword = "Wudox-SuperAdmin-2025!",
  [string]$DemoPassword = "password123",
  [string]$EmailDomain = "wudox.ca",
  [switch]$SkipE2E
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$script:ApiV1 = "$ApiBase/api/v1"
$script:Passed = 0
$script:Failed = 0
$script:Skipped = 0
$script:Results = [System.Collections.Generic.List[object]]::new()

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host "=== $Title ===" -ForegroundColor Cyan
}

function Record-Result {
  param(
    [string]$Name,
    [ValidateSet("pass", "fail", "skip")]
    [string]$Status,
    [string]$Detail = ""
  )
  switch ($Status) {
    "pass" { $script:Passed++; $color = "Green"; $mark = "PASS" }
    "fail" { $script:Failed++; $color = "Red"; $mark = "FAIL" }
    "skip" { $script:Skipped++; $color = "Yellow"; $mark = "SKIP" }
  }
  $line = "[$mark] $Name"
  if ($Detail) { $line += " - $Detail" }
  Write-Host $line -ForegroundColor $color
  $script:Results.Add([pscustomobject]@{ Status = $mark; Name = $Name; Detail = $Detail })
}

function Invoke-Json {
  param(
    [string]$Method = "GET",
    [string]$Uri,
    [hashtable]$Headers = @{},
    [object]$Body = $null
  )
  $params = @{
    Method      = $Method
    Uri         = $Uri
    Headers     = $Headers
    ContentType = "application/json"
  }
  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
  }
  try {
  return Invoke-RestMethod @params
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $reader = [System.IO.StreamReader]::new($resp.GetResponseStream())
      $text = $reader.ReadToEnd()
      $reader.Close()
      throw ($_.Exception.Message + " | " + $text)
    }
    throw
  }
}

function Login-User {
  param([string]$Email, [string]$Password)
  $res = Invoke-Json -Method POST -Uri "$script:ApiV1/auth/login" -Body @{
    email    = $Email
    password = $Password
  }
  return @{
    Token       = $res.token
    User        = $res.user
    Permissions = [string[]]@($res.permissions)
    Scope       = $res.dataScopeLevel
    Role        = $res.user.role
    RoleLabel   = $res.roleLabel
  }
}

function Auth-Headers {
  param([string]$Token)
  return @{ Authorization = "Bearer $Token" }
}

function Assert-ContainsAll {
  param(
    [string]$Name,
    [string[]]$Actual,
    [string[]]$Expected
  )
  $missing = @($Expected | Where-Object { $_ -notin $Actual })
  if ($missing.Count -eq 0) {
    Record-Result $Name "pass"
  } else {
    Record-Result $Name "fail" ("missing: $($missing -join ', ')")
  }
}

function Assert-ContainsNone {
  param(
    [string]$Name,
    [string[]]$Actual,
    [string[]]$Forbidden
  )
  $found = @($Forbidden | Where-Object { $_ -in $Actual })
  if ($found.Count -eq 0) {
    Record-Result $Name "pass"
  } else {
    Record-Result $Name "fail" ("unexpected: $($found -join ', ')")
  }
}

function Assert-Equal {
  param([string]$Name, $Expected, $Actual)
  if ("$Expected" -eq "$Actual") {
    Record-Result $Name "pass" "$Actual"
  } else {
    Record-Result $Name "fail" ("expected '$Expected', got '$Actual'")
  }
}

function Get-HttpStatusCode {
  param([System.Management.Automation.ErrorRecord]$ErrorRecord)
  $ex = $ErrorRecord.Exception
  if ($ex -and $ex.PSObject.Properties.Match('Response').Count -gt 0 -and $ex.Response) {
    return [int]$ex.Response.StatusCode
  }
  if ($ex -and $ex.Message -match '\((\d{3})\)') {
    return [int]$Matches[1]
  }
  return $null
}

function Assert-HttpStatus {
  param(
    [string]$Name,
    [string]$Method,
    [string]$Uri,
    [hashtable]$Headers,
    [int]$ExpectedStatus,
    [object]$Body = $null
  )
  try {
    Invoke-Json -Method $Method -Uri $Uri -Headers $Headers -Body $Body | Out-Null
    Record-Result $Name "fail" "expected HTTP $ExpectedStatus but request succeeded"
  } catch {
    $status = Get-HttpStatusCode $_
    if ($status -eq $ExpectedStatus) {
      Record-Result $Name "pass" "HTTP $status"
    } else {
      Record-Result $Name "fail" ("expected HTTP $ExpectedStatus, got $status - " + $_.Exception.Message)
    }
  }
}

function Assert-AllPropertyEqual {
  param(
    [string]$Name,
    [object[]]$Items,
    [string]$Property,
    [string]$Expected
  )
  if ($Items.Count -eq 0) {
    Record-Result $Name "skip" "no rows returned"
    return
  }
  $bad = @($Items | Where-Object { "$($_.$Property)" -ne "$Expected" })
  if ($bad.Count -eq 0) {
    Record-Result $Name "pass" "$($Items.Count) rows, $Property=$Expected"
  } else {
    Record-Result $Name "fail" "$($bad.Count)/$($Items.Count) rows with wrong $Property"
  }
}

# ── Role fixtures (seed.ts) ───────────────────────────────────────────────────

$RoleAccounts = @(
  @{
    Label    = "Super Admin"
    Email    = $SuperAdminEmail
    Password = $SuperAdminPassword
    Role     = "super_admin"
    Scope    = "global"
    MustHave = @("roles:write", "clients:approve", "leads:approve", "settings:write", "users:write", "agencies:global")
    MustNot  = @()
  },
  @{
    Label    = "Director"
    Email    = "director@$EmailDomain"
    Password = $DemoPassword
    Role     = "director"
    Scope    = "agency"
    MustHave = @("roles:read", "clients:approve", "settings:write", "agencies:cross_org")
    MustNot  = @("agencies:global")
  },
  @{
    Label    = "Company Director (Toronto)"
    Email    = "company.director@$EmailDomain"
    Password = $DemoPassword
    Role     = "company_director"
    Scope    = "agency"
    MustHave = @("roles:write", "clients:approve", "settings:write", "users:write")
    MustNot  = @("agencies:global")
  },
  @{
    Label    = "Sales Manager (Toronto)"
    Email    = "manager1@$EmailDomain"
    Password = $DemoPassword
    Role     = "sales_manager"
    Scope    = "team"
    MustHave = @("clients:manager_recommend", "leads:manager_recommend", "settings:read", "users:directory")
    MustNot  = @("clients:approve", "roles:write", "settings:write")
  },
  @{
    Label    = "Sales Associate (Toronto)"
    Email    = "associate1@$EmailDomain"
    Password = $DemoPassword
    Role     = "sales_associate"
    Scope    = "own"
    MustHave = @("leads:write", "pipeline:write", "clients:read", "analytics:read")
    MustNot  = @("settings:write", "users:write", "clients:approve", "roles:read")
  },
  @{
    Label    = "Database Manager"
    Email    = "db.manager@$EmailDomain"
    Password = $DemoPassword
    Role     = "database_manager"
    Scope    = "agency"
    MustHave = @("clients:read", "clients:write")
    MustNot  = @("settings:write", "leads:approve", "roles:write")
  },
  @{
    Label    = "Sales Associate (Vancouver)"
    Email    = "associate.vancouver@$EmailDomain"
    Password = $DemoPassword
    Role     = "sales_associate"
    Scope    = "own"
    MustHave = @("leads:write", "clients:read")
    MustNot  = @("settings:write", "agencies:cross_org")
  },
  @{
    Label    = "Sales Manager (Vancouver)"
    Email    = "manager2@$EmailDomain"
    Password = $DemoPassword
    Role     = "sales_manager"
    Scope    = "team"
    MustHave = @("leads:manager_recommend", "settings:read")
    MustNot  = @("agencies:cross_org")
  },
  @{
    Label    = "Company Director (Vancouver)"
    Email    = "company.director.vancouver@$EmailDomain"
    Password = $DemoPassword
    Role     = "company_director"
    Scope    = "agency"
    MustHave = @("clients:approve", "settings:write")
    MustNot  = @("agencies:cross_org", "agencies:global")
  }
)

Write-Host "Wudox RBAC release smoke" -ForegroundColor White
Write-Host "API: $script:ApiV1"
if ($SkipE2E) { Write-Host "E2E workflows: SKIPPED" -ForegroundColor Yellow }

# ── 1. Health ─────────────────────────────────────────────────────────────────

Write-Section "Connectivity"
try {
  $health = Invoke-Json -Uri "$ApiBase/health"
  if ($health.status -eq "ok" -or $health.ok -eq $true -or $null -ne $health) {
    Record-Result "GET /health" "pass"
  } else {
    Record-Result "GET /health" "fail" "unexpected body"
  }
} catch {
  Record-Result "GET /health" "fail" $_.Exception.Message
  Write-Host ""
  Write-Host "Backend not reachable. Start API and re-run." -ForegroundColor Red
  exit 1
}

# ── 2. Login + permissions per role ───────────────────────────────────────────

Write-Section "Auth & permissions"
$sessions = @{}

foreach ($acct in $RoleAccounts) {
  try {
    $s = Login-User -Email $acct.Email -Password $acct.Password
    $sessions[$acct.Label] = $s
    Assert-Equal "$($acct.Label) role" $acct.Role $s.Role
    Assert-Equal "$($acct.Label) data scope" $acct.Scope $s.Scope
    Assert-ContainsAll "$($acct.Label) required permissions" $s.Permissions $acct.MustHave
    if ($acct.MustNot.Count -gt 0) {
      Assert-ContainsNone "$($acct.Label) forbidden permissions" $s.Permissions $acct.MustNot
    }
  } catch {
    Record-Result "$($acct.Label) login" "fail" $_.Exception.Message
  }
}

$sa = $sessions["Super Admin"]
$assoc = $sessions["Sales Associate (Toronto)"]
$mgr = $sessions["Sales Manager (Toronto)"]
$cd = $sessions["Company Director (Toronto)"]
$dbm = $sessions["Database Manager"]
$director = $sessions["Director"]
$vAssoc = $sessions["Sales Associate (Vancouver)"]
$vMgr = $sessions["Sales Manager (Vancouver)"]
$vCd = $sessions["Company Director (Vancouver)"]

if (-not $sa) {
  Write-Host "Super Admin login failed - cannot continue metadata tests." -ForegroundColor Red
  exit 1
}

$saH = Auth-Headers $sa.Token

# ── 3. Roles tree ─────────────────────────────────────────────────────────────

Write-Section "Roles API"
try {
  $rolesRes = Invoke-Json -Uri "$script:ApiV1/roles" -Headers $saH
  $tree = @($rolesRes.data)
  if ($tree.Count -ge 1) {
    Record-Result "GET /roles tree" "pass" "$($tree.Count) root node(s)"
  } else {
    Record-Result "GET /roles tree" "fail" "empty tree - run npm run prisma:seed-rbac"
  }
} catch {
  Record-Result "GET /roles tree" "fail" $_.Exception.Message
}

try {
  $permRes = Invoke-Json -Uri "$script:ApiV1/roles/permissions" -Headers $saH
  $leaves = 0
  function Count-Leaves($nodes) {
    foreach ($n in $nodes) {
      if ($n.children -and $n.children.Count -gt 0) { Count-Leaves $n.children }
      elseif (-not $n.isGroup) { $script:leafCount++ }
    }
  }
  $script:leafCount = 0
  Count-Leaves @($permRes.data)
  if ($script:leafCount -gt 20) {
    Record-Result "GET /roles/permissions catalog" "pass" "$($script:leafCount) permission leaves"
  } else {
    Record-Result "GET /roles/permissions catalog" "fail" "too few permissions ($($script:leafCount))"
  }
} catch {
  Record-Result "GET /roles/permissions catalog" "fail" $_.Exception.Message
}

# ── 4. Approval metadata & policies ───────────────────────────────────────────

Write-Section "Approval configuration"

try {
  $meta = Invoke-Json -Uri "$script:ApiV1/approvals/metadata" -Headers $saH
  $workflows = @($meta.data.workflows)
  $expectedWorkflows = @(
    "client_manual_add", "client_manual_edit", "client_import",
    "lead_request", "lead_extension", "lead_reassignment",
    "proposal_review", "proposal_extension",
    "database_client_add", "database_client_import"
  )
  $types = @($workflows | ForEach-Object { $_.workflow })
  $missingWf = @($expectedWorkflows | Where-Object { $_ -notin $types })
  if ($missingWf.Count -eq 0) {
    Record-Result "GET /approvals/metadata workflows" "pass" "$($workflows.Count) workflows"
  } else {
    Record-Result "GET /approvals/metadata workflows" "fail" ("missing: $($missingWf -join ', ')")
  }
} catch {
  Record-Result "GET /approvals/metadata workflows" "fail" $_.Exception.Message
}

try {
  $org = Invoke-Json -Uri "$script:ApiV1/settings/org-approval-policy" -Headers $saH
  $orgWf = $org.data.workflows
  if ($orgWf.database_client_add -and $orgWf.database_client_import) {
    Record-Result "GET /settings/org-approval-policy" "pass" (
      "add=$($orgWf.database_client_add.mode) import=$($orgWf.database_client_import.mode)"
    )
  } else {
    Record-Result "GET /settings/org-approval-policy" "fail" "workflows missing"
  }
} catch {
  Record-Result "GET /settings/org-approval-policy" "fail" $_.Exception.Message
}

$torontoId = if ($assoc) { $assoc.User.subCompanyId } else { $null }
if (-not $torontoId) {
  Record-Result "Toronto agency context" "fail" "associate has no subCompanyId"
} else {
  try {
    $policy = Invoke-Json -Uri "$script:ApiV1/settings/approval-policy?subCompanyId=$torontoId" -Headers $saH
    $wf = $policy.data.workflows
    $clientAdd = $wf.client_manual_add
    if ($clientAdd.mode -eq "route" -and $clientAdd.route -contains "sales_manager" -and $clientAdd.route -contains "company_director") {
      Record-Result "Toronto client_manual_add route" "pass" ($clientAdd.route -join " -> ")
    } else {
      Record-Result "Toronto client_manual_add route" "fail" ("unexpected: mode=$($clientAdd.mode) route=$($clientAdd.route -join ',')")
    }
    if ($policy.data.allowLeadSelfAssign -eq $true) {
      Record-Result "Toronto allowLeadSelfAssign default" "pass"
    } else {
      Record-Result "Toronto allowLeadSelfAssign default" "fail" "expected true"
    }
  } catch {
    Record-Result "GET /settings/approval-policy (Toronto)" "fail" $_.Exception.Message
  }
}

# ── 5. Multi-agency isolation ───────────────────────────────────────────────────

Write-Section "Multi-agency"

$torontoId = if ($assoc) { $assoc.User.subCompanyId } else { $null }
$vancouverId = if ($vAssoc) { $vAssoc.User.subCompanyId } else { $null }

if (-not $torontoId -or -not $vancouverId) {
  if (-not $vAssoc) {
    Record-Result "Toronto and Vancouver agency ids" "skip" "Vancouver associate login failed"
  } else {
    Record-Result "Toronto and Vancouver agency ids" "fail" "missing subCompanyId on seed users"
  }
} elseif ($torontoId -eq $vancouverId) {
  Record-Result "Toronto and Vancouver agency ids" "fail" "same subCompanyId on both associates"
} else {
  Record-Result "Toronto and Vancouver agency ids" "pass" "distinct agencies"
}

try {
  $agencies = Invoke-Json -Uri "$script:ApiV1/users/sub-companies" -Headers (Auth-Headers $assoc.Token)
  $agencyList = @($agencies.data)
  $names = @($agencyList | ForEach-Object { $_.name })
  if ($agencyList.Count -ge 2 -and ($names -match "Toronto") -and ($names -match "Vancouver")) {
    Record-Result "GET /users/sub-companies" "pass" "$($agencyList.Count) agencies"
  } else {
    Record-Result "GET /users/sub-companies" "fail" ("found: $($names -join ', ')")
  }
} catch {
  Record-Result "GET /users/sub-companies" "fail" $_.Exception.Message
}

if ($assoc -and $torontoId) {
  try {
    $tLeads = Invoke-Json -Uri "$script:ApiV1/leads?limit=100" -Headers (Auth-Headers $assoc.Token)
    Assert-AllPropertyEqual "Toronto associate leads scoped to Toronto" @($tLeads.data) "subCompanyId" $torontoId
  } catch {
    Record-Result "Toronto associate leads scoped to Toronto" "fail" $_.Exception.Message
  }
}

if ($vAssoc -and $vancouverId) {
  try {
    $vLeads = Invoke-Json -Uri "$script:ApiV1/leads?limit=100" -Headers (Auth-Headers $vAssoc.Token)
    Assert-AllPropertyEqual "Vancouver associate leads scoped to Vancouver" @($vLeads.data) "subCompanyId" $vancouverId
  } catch {
    Record-Result "Vancouver associate leads scoped to Vancouver" "fail" $_.Exception.Message
  }
}

if ($assoc -and $vAssoc -and $torontoId -and $vancouverId) {
  try {
    $tLeads = Invoke-Json -Uri "$script:ApiV1/leads?limit=100" -Headers (Auth-Headers $assoc.Token)
    $vLeads = Invoke-Json -Uri "$script:ApiV1/leads?limit=100" -Headers (Auth-Headers $vAssoc.Token)
    $tIds = @($tLeads.data | ForEach-Object { $_.id })
    $overlap = @($vLeads.data | Where-Object { $_.id -in $tIds })
    if ($overlap.Count -eq 0) {
      Record-Result "Lead lists isolated between agencies" "pass" "0 shared lead ids"
    } else {
      Record-Result "Lead lists isolated between agencies" "fail" "$($overlap.Count) lead ids appear in both agencies"
    }
  } catch {
    Record-Result "Lead lists isolated between agencies" "fail" $_.Exception.Message
  }
}

if ($director -and $torontoId -and $vancouverId) {
  try {
    $dLeads = Invoke-Json -Uri "$script:ApiV1/leads?limit=200" -Headers (Auth-Headers $director.Token)
    $dSubs = @($dLeads.data | ForEach-Object { $_.subCompanyId } | Select-Object -Unique)
    if (($torontoId -in $dSubs) -and ($vancouverId -in $dSubs)) {
      Record-Result "Director cross-org leads span agencies" "pass" ($dSubs -join ", ")
    } else {
      Record-Result "Director cross-org leads span agencies" "fail" ("subs: $($dSubs -join ', ')")
    }
  } catch {
    Record-Result "Director cross-org leads span agencies" "fail" $_.Exception.Message
  }
}

if ($cd) {
  Assert-ContainsNone "Company Director (Toronto) no cross-org" $cd.Permissions @("agencies:cross_org")
}
if ($director) {
  Assert-ContainsAll "Director has cross-org permission" $director.Permissions @("agencies:cross_org")
}

if ($mgr -and $vMgr -and $torontoId -and $vancouverId) {
  try {
    $tPending = Invoke-Json -Uri "$script:ApiV1/clients/pending-submissions" -Headers (Auth-Headers $mgr.Token)
    $vPending = Invoke-Json -Uri "$script:ApiV1/clients/pending-submissions" -Headers (Auth-Headers $vMgr.Token)
    $tPendingRows = @($tPending)
    if ($tPendingRows.Count -gt 0) {
      $badT = @($tPendingRows | Where-Object { "$($_.subCompanyId)" -ne "$torontoId" })
      if ($badT.Count -eq 0) {
        Record-Result "Toronto manager client pending queue" "pass" "$($tPendingRows.Count) rows"
      } else {
        Record-Result "Toronto manager client pending queue" "fail" "$($badT.Count) rows from other agencies"
      }
    } else {
      Record-Result "Toronto manager client pending queue" "skip" "no pending rows"
    }
    $vPendingRows = @($vPending)
    if ($vPendingRows.Count -gt 0) {
      $badV = @($vPendingRows | Where-Object { "$($_.subCompanyId)" -ne "$vancouverId" })
      if ($badV.Count -eq 0) {
        Record-Result "Vancouver manager client pending queue" "pass" "$($vPendingRows.Count) rows"
      } else {
        Record-Result "Vancouver manager client pending queue" "fail" "$($badV.Count) rows from other agencies"
      }
    } else {
      Record-Result "Vancouver manager client pending queue" "skip" "no pending rows"
    }
    $tPendingIds = @($tPendingRows | ForEach-Object { $_.id })
    $pendingOverlap = @($vPendingRows | Where-Object { $_.id -in $tPendingIds })
    if ($pendingOverlap.Count -eq 0) {
      Record-Result "Client pending queues isolated between agencies" "pass"
    } else {
      Record-Result "Client pending queues isolated between agencies" "fail" "$($pendingOverlap.Count) shared ids"
    }
  } catch {
    Record-Result "Client pending queue agency isolation" "fail" $_.Exception.Message
  }
}

if ($mgr -and $vMgr -and $torontoId -and $vancouverId) {
  try {
    $tLr = Invoke-Json -Uri "$script:ApiV1/lead-requests?status=pending" -Headers (Auth-Headers $mgr.Token)
    $vLr = Invoke-Json -Uri "$script:ApiV1/lead-requests?status=pending" -Headers (Auth-Headers $vMgr.Token)
    if (@($tLr.data).Count -gt 0) {
      Assert-AllPropertyEqual "Toronto manager pending lead requests" @($tLr.data) "subCompanyId" $torontoId
    } else {
      Record-Result "Toronto manager pending lead requests" "skip" "no pending rows"
    }
    if (@($vLr.data).Count -gt 0) {
      Assert-AllPropertyEqual "Vancouver manager pending lead requests" @($vLr.data) "subCompanyId" $vancouverId
    } else {
      Record-Result "Vancouver manager pending lead requests" "skip" "no pending rows"
    }
    $tLrIds = @($tLr.data | ForEach-Object { $_.id })
    $cross = @($vLr.data | Where-Object { $_.id -in $tLrIds })
    if ($cross.Count -eq 0) {
      Record-Result "Lead request queues isolated between agencies" "pass"
    } else {
      Record-Result "Lead request queues isolated between agencies" "fail" "$($cross.Count) shared request ids"
    }
  } catch {
    Record-Result "Lead request agency isolation" "fail" $_.Exception.Message
  }
}

if ($sa -and $vancouverId) {
  try {
    $vPolicy = Invoke-Json -Uri "$script:ApiV1/settings/approval-policy?subCompanyId=$vancouverId" -Headers $saH
    $vClientAdd = $vPolicy.data.workflows.client_manual_add
    if ($vClientAdd.mode -eq "route") {
      Record-Result "Vancouver approval policy configured" "pass" ($vClientAdd.route -join " -> ")
    } else {
      Record-Result "Vancouver approval policy configured" "fail" "mode=$($vClientAdd.mode)"
    }
  } catch {
    Record-Result "Vancouver approval policy configured" "fail" $_.Exception.Message
  }
}

if ($cd -and $vCd -and $torontoId -and $vancouverId) {
  if ($cd.User.subCompanyId -eq $torontoId -and $vCd.User.subCompanyId -eq $vancouverId) {
    Record-Result "Company directors bound to home agencies" "pass"
  } else {
    Record-Result "Company directors bound to home agencies" "fail" (
      "toronto=$($cd.User.subCompanyId) vancouver=$($vCd.User.subCompanyId)"
    )
  }
}

# ── 6. Permission gates ───────────────────────────────────────────────────────

Write-Section "Access gates"

if ($assoc) {
  Assert-HttpStatus `
    -Name "Associate cannot read approval policy" `
    -Method GET `
    -Uri "$script:ApiV1/settings/approval-policy" `
    -Headers (Auth-Headers $assoc.Token) `
    -ExpectedStatus 403
}

if ($mgr) {
  try {
    Invoke-Json -Uri "$script:ApiV1/settings/approval-policy" -Headers (Auth-Headers $mgr.Token) | Out-Null
    Record-Result "Manager blocked from approval policy (no settings:write)" "fail" "request succeeded"
  } catch {
    $status = Get-HttpStatusCode $_
    if ($status -eq 403) {
      Record-Result "Manager blocked from approval policy (no settings:write)" "pass" "HTTP 403"
    } else {
      Record-Result "Manager blocked from approval policy (no settings:write)" "fail" "HTTP $status"
    }
  }
}

# ── 7. E2E workflows (mutating) ───────────────────────────────────────────────

if ($SkipE2E) {
  Write-Section "E2E workflows"
  Record-Result "Client approval chain (Toronto)" "skip" "-SkipE2E"
  Record-Result "Client approval chain (Vancouver)" "skip" "-SkipE2E"
  Record-Result "Lead request flow" "skip" "-SkipE2E"
  Record-Result "Database Manager global add" "skip" "-SkipE2E"
  Record-Result "Cross-agency manager isolation" "skip" "-SkipE2E"
} else {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"

  Write-Section "E2E: client manual add approval chain (Toronto)"

  if ($assoc -and $mgr -and $cd -and $torontoId) {
    $clientBody = @{
      name     = "Release Smoke Client $stamp"
      industry = "Technology"
      location = "Toronto"
      contacts = @(
        @{
          name      = "Smoke Test"
          email     = "smoke-$stamp@example.com"
          phone     = "+14165550099"
          isPrimary = $true
        }
      )
      tags     = @("release-smoke")
    }

    try {
      $create = Invoke-Json -Method POST -Uri "$script:ApiV1/clients" `
        -Headers (Auth-Headers $assoc.Token) -Body $clientBody

      if ($create.pendingSubmission -eq $true -and $create.id) {
        Record-Result "Associate submits client" "pass" $create.id
        $pendingId = $create.id

        $mgrH = Auth-Headers $mgr.Token
        $subBody = @{ subCompanyId = $torontoId }

        $fwd = Invoke-Json -Method POST `
          -Uri "$script:ApiV1/clients/pending-submissions/$pendingId/manager-approve" `
          -Headers $mgrH -Body $subBody
        Record-Result "Manager forwards pending client" "pass"

        $appr = Invoke-Json -Method POST `
          -Uri "$script:ApiV1/clients/pending-submissions/$pendingId/approve" `
          -Headers (Auth-Headers $cd.Token) -Body $subBody

        if ($appr.name -or $appr.clientId) {
          $approvedLabel = if ($appr.name) { $appr.name } else { $appr.clientId }
          Record-Result "Company Director approves client" "pass" $approvedLabel
        } else {
          Record-Result "Company Director approves client" "fail" "no client in response"
        }
      } else {
        Record-Result "Associate submits client" "fail" "expected pendingSubmission=true"
      }
    } catch {
      Record-Result "Client approval chain" "fail" $_.Exception.Message
    }
  } else {
    Record-Result "Client approval chain (Toronto)" "skip" "missing session(s) or agency id"
  }

  Write-Section "E2E: client manual add approval chain (Vancouver)"

  if ($vAssoc -and $vMgr -and $vCd -and $vancouverId) {
    $vClientBody = @{
      name     = "Release Smoke Vancouver $stamp"
      industry = "Technology"
      location = "Vancouver"
      contacts = @(
        @{
          name      = "Vancouver Smoke"
          email     = "vsmoke-$stamp@example.com"
          phone     = "+16045550099"
          isPrimary = $true
        }
      )
      tags     = @("release-smoke", "vancouver")
    }

    try {
      $vCreate = Invoke-Json -Method POST -Uri "$script:ApiV1/clients" `
        -Headers (Auth-Headers $vAssoc.Token) -Body $vClientBody

      if ($vCreate.pendingSubmission -eq $true -and $vCreate.id) {
        Record-Result "Vancouver associate submits client" "pass" $vCreate.id
        $vPendingId = $vCreate.id
        $vSubBody = @{ subCompanyId = $vancouverId }
        $vMgrH = Auth-Headers $vMgr.Token
        $tMgrH = Auth-Headers $mgr.Token

        $tQueue = @($(Invoke-Json -Uri "$script:ApiV1/clients/pending-submissions" -Headers $tMgrH))
        $vQueue = @($(Invoke-Json -Uri "$script:ApiV1/clients/pending-submissions" -Headers $vMgrH))
        $inTorontoQueue = @($tQueue | Where-Object { $_.id -eq $vPendingId })
        $inVancouverQueue = @($vQueue | Where-Object { $_.id -eq $vPendingId })
        if ($inTorontoQueue.Count -eq 0) {
          Record-Result "Vancouver pending hidden from Toronto manager queue" "pass"
        } else {
          Record-Result "Vancouver pending hidden from Toronto manager queue" "fail" "found in Toronto queue"
        }
        if ($inVancouverQueue.Count -eq 1) {
          Record-Result "Vancouver pending visible to Vancouver manager queue" "pass"
        } else {
          Record-Result "Vancouver pending visible to Vancouver manager queue" "fail" "not in Vancouver queue"
        }

        Invoke-Json -Method POST `
          -Uri "$script:ApiV1/clients/pending-submissions/$vPendingId/manager-approve" `
          -Headers $vMgrH -Body $vSubBody | Out-Null
        Record-Result "Vancouver manager forwards pending client" "pass"

        $vAppr = Invoke-Json -Method POST `
          -Uri "$script:ApiV1/clients/pending-submissions/$vPendingId/approve" `
          -Headers (Auth-Headers $vCd.Token) -Body $vSubBody

        if ($vAppr.name -or $vAppr.clientId) {
          $vLabel = if ($vAppr.name) { $vAppr.name } else { $vAppr.clientId }
          Record-Result "Vancouver company director approves client" "pass" $vLabel
        } else {
          Record-Result "Vancouver company director approves client" "fail" "no client in response"
        }
      } else {
        Record-Result "Vancouver associate submits client" "fail" "expected pendingSubmission=true"
      }
    } catch {
      Record-Result "Client approval chain (Vancouver)" "fail" $_.Exception.Message
    }
  } else {
    Record-Result "Client approval chain (Vancouver)" "skip" "missing Vancouver session(s) or agency id"
  }

  Write-Section "E2E: lead request"

  if ($assoc -and $mgr) {
    try {
      $assocH = Auth-Headers $assoc.Token
      $mgrH = Auth-Headers $mgr.Token
      $pendingMgr = Invoke-Json -Uri "$script:ApiV1/lead-requests?status=pending" -Headers $mgrH
      $reuse = @($pendingMgr.data) | Where-Object { $_.requestedBy -eq $assoc.User.id } | Select-Object -First 1

      if ($reuse) {
        Record-Result "Associate creates lead request" "pass" "reusing pending $($reuse.id) on $($reuse.clientName)"
        Record-Result "Manager sees pending lead request" "pass"
        try {
          $approved = Invoke-Json -Method PATCH `
            -Uri "$script:ApiV1/lead-requests/$($reuse.id)/approve" `
            -Headers $mgrH -Body @{}
          if ($approved.leadId) {
            Record-Result "Manager approves lead request" "pass" "leadId=$($approved.leadId)"
          } else {
            Record-Result "Manager approves lead request" "pass" "approved existing pending request"
          }
        } catch {
          $code = Get-HttpStatusCode $_
          if ($code -eq 409 -or $code -eq 400) {
            Record-Result "Manager approves lead request" "skip" "blocked by existing lead on client (HTTP $code)"
          } else {
            Record-Result "Manager approves lead request" "fail" $_.Exception.Message
          }
        }
      } else {
        $clientsRes = Invoke-Json -Uri "$script:ApiV1/clients?limit=80" -Headers $assocH
        $leadsRes = Invoke-Json -Uri "$script:ApiV1/leads?limit=500" -Headers $mgrH
        $pendingAssoc = Invoke-Json -Uri "$script:ApiV1/lead-requests?status=pending" -Headers $assocH
        $openStatuses = @("open", "active", "closed_won_pending")
        $busyClientIds = @(
          $leadsRes.data | Where-Object { $_.status -in $openStatuses } | ForEach-Object { $_.clientId }
        ) | Select-Object -Unique
        $pendingClientIds = @($pendingAssoc.data | ForEach-Object { $_.clientId }) | Select-Object -Unique

        $candidates = @($clientsRes.data | Where-Object {
          $_.id -notin $busyClientIds -and $_.id -notin $pendingClientIds
        })

        $created = $false
        foreach ($client in $candidates) {
          try {
            $lrBody = @{
              clientId  = $client.id
              managerId = $mgr.User.id
              note      = "Release smoke lead request $stamp"
            }
            $lr = Invoke-Json -Method POST -Uri "$script:ApiV1/lead-requests" -Headers $assocH -Body $lrBody
            if ($lr.id -and $lr.status -eq "pending") {
              Record-Result "Associate creates lead request" "pass" "client=$($client.name)"
              $found = @($pendingMgr.data) + @($lr)
              $inQueue = Invoke-Json -Uri "$script:ApiV1/lead-requests?status=pending" -Headers $mgrH
              $visible = @($inQueue.data) | Where-Object { $_.id -eq $lr.id }
              if ($visible.Count -eq 1) {
                Record-Result "Manager sees pending lead request" "pass"
              } else {
                Record-Result "Manager sees pending lead request" "fail" "not in queue"
              }
              try {
                $approved = Invoke-Json -Method PATCH `
                  -Uri "$script:ApiV1/lead-requests/$($lr.id)/approve" `
                  -Headers $mgrH -Body @{}
                $approveDetail = if ($approved.leadId) { "leadId=$($approved.leadId)" } else { "approved" }
                Record-Result "Manager approves lead request" "pass" $approveDetail
              } catch {
                $code = Get-HttpStatusCode $_
                if ($code -eq 409 -or $code -eq 400) {
                  Record-Result "Manager approves lead request" "skip" "blocked by existing lead on client (HTTP $code)"
                } else {
                  Record-Result "Manager approves lead request" "fail" $_.Exception.Message
                }
              }
              $created = $true
              break
            }
          } catch {
            $code = Get-HttpStatusCode $_
            if ($code -eq 409) { continue }
            throw
          }
        }

        if (-not $created) {
          Record-Result "Lead request (find or create)" "skip" "no eligible client after $($candidates.Count) tries"
        }
      }
    } catch {
      Record-Result "Lead request flow" "fail" $_.Exception.Message
    }
  } else {
    Record-Result "Lead request flow" "skip" "missing associate or manager session"
  }

  Write-Section "E2E: Database Manager global add"

  if ($dbm) {
    try {
      $dbStamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $dbBody = @{
        name     = "Release Smoke Global $dbStamp"
        industry = "Healthcare"
        contacts = @(@{ name = "DB Smoke"; email = "db-$dbStamp@example.com"; isPrimary = $true })
      }
      $dbCreate = Invoke-Json -Method POST -Uri "$script:ApiV1/clients" `
        -Headers (Auth-Headers $dbm.Token) -Body $dbBody

      if ($dbCreate.globalDatabase -eq $true) {
        if ($dbCreate.autoApproved -eq $true -or $dbCreate.pendingSubmission -eq $false) {
          Record-Result "Database Manager client add" "pass" (
            "autoApproved=$($dbCreate.autoApproved) pending=$($dbCreate.pendingSubmission)"
          )
        } elseif ($dbCreate.pendingSubmission -eq $true) {
          Record-Result "Database Manager client add" "pass" "submitted for org approval (require-approval mode)"
        } else {
          Record-Result "Database Manager client add" "fail" "unexpected response shape"
        }
      } else {
        Record-Result "Database Manager client add" "fail" "globalDatabase not true"
      }
    } catch {
      Record-Result "Database Manager client add" "fail" $_.Exception.Message
    }
  } else {
    Record-Result "Database Manager client add" "skip" "login failed"
  }
}

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "========================================" -ForegroundColor White
Write-Host " PASSED: $script:Passed   FAILED: $script:Failed   SKIPPED: $script:Skipped" -ForegroundColor White
Write-Host "========================================" -ForegroundColor White

if ($script:Failed -gt 0) {
  Write-Host ""
  Write-Host "Failures:" -ForegroundColor Red
  $script:Results | Where-Object { $_.Status -eq "FAIL" } | ForEach-Object {
    Write-Host "  - $($_.Name): $($_.Detail)" -ForegroundColor Red
  }
  exit 1
}

Write-Host ""
Write-Host "All checks passed." -ForegroundColor Green
exit 0
