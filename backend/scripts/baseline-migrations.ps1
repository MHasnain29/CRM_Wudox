# Mark migrations as already applied when the local DB was created outside Prisma migrate history.
# Skips migrations that still need to run (new columns/tables).
$skip = @(
  '20260521120000_documents_agency_scoping',
  '20260521130000_documents_is_public',
  '20260522120000_add_countries_to_enum'
)

$dirs = Get-ChildItem -Path 'prisma\migrations' -Directory | Sort-Object Name
foreach ($d in $dirs) {
  $name = $d.Name
  if ($skip -contains $name) {
    Write-Host "SKIP (will deploy): $name"
    continue
  }
  Write-Host "resolve --applied: $name"
  npx prisma migrate resolve --applied $name 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Failed or already applied: $name"
  }
}

Write-Host "`nRunning migrate deploy for remaining migrations..."
npx prisma migrate deploy
