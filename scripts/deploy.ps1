param(
  # Proceed even when git has uncommitted changes (you may lose local edits on pull).
  [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Run-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Command
  )

  Write-Host ""
  Write-Host "==> $Name"
  Write-Host "    $Command"

  Invoke-Expression $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Step failed: $Name"
  }
}

Write-Host "Starting Wudox production deploy..."

$status = git status --porcelain
if ($status -and -not $AllowDirty) {
  Write-Host ""
  Write-Host "Deployment aborted: your git working tree is not clean." -ForegroundColor Yellow
  Write-Host "Uncommitted / untracked:"
  git status --short
  Write-Host ""
  Write-Host "Fix: commit or stash, then run deploy again."
  Write-Host "Or (at your own risk): npm run deploy:force"
  exit 1
}
if ($status -and $AllowDirty) {
  Write-Host ""
  Write-Host "AllowDirty: continuing with a dirty working tree." -ForegroundColor Yellow
  Write-Host "Pull may fail or merge; uncommitted changes are not protected."
  git status --short
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if (-not $branch) {
  throw "Could not determine current git branch."
}

Run-Step -Name "Fetch latest from origin" -Command "git fetch origin"
Run-Step -Name "Fast-forward pull $branch" -Command "git pull --ff-only origin $branch"

Run-Step -Name "Install root deps" -Command "npm install"
Run-Step -Name "Install frontend deps" -Command "npm install --prefix frontend"
Run-Step -Name "Install backend deps" -Command "npm install --prefix backend"

Run-Step -Name "Build frontend into backend/client" -Command "npm run build --prefix frontend"
if (-not (Test-Path "./backend/client/index.html")) {
  throw "Frontend build output missing: ./backend/client/index.html"
}
Write-Host "Frontend build present under backend/client"

# On Windows, running Node can lock Prisma's query engine DLL; stop app before generate.
Write-Host ""
Write-Host "==> Stop CRM in PM2 (release Prisma engine lock on Windows)"
pm2 stop wudox-crm 2>$null
# Do not fail deploy if process was already stopped / missing

Run-Step -Name "Apply backend Prisma migrations" -Command "npm run prisma:migrate:deploy --prefix backend"
Run-Step -Name "Regenerate Prisma client" -Command "npm run prisma:generate --prefix backend"
Run-Step -Name "Build backend (TypeScript)" -Command "npm run build --prefix backend"

Run-Step -Name "Start CRM with PM2" -Command "pm2 start wudox-crm"
Run-Step -Name "Save PM2 process list" -Command "pm2 save"

Write-Host ""
Write-Host "Deploy completed successfully." -ForegroundColor Green
Write-Host "Check status with: pm2 ls"
Write-Host "Check logs with: pm2 logs wudox-crm --lines 200"
