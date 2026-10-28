$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envExample = Join-Path $repoRoot '.env.example'
$envPath = Join-Path $repoRoot '.env'

if (-not (Test-Path $envExample)) {
    throw "Missing .env.example at $envExample"
}

if (-not (Test-Path $envPath)) {
    Copy-Item $envExample $envPath
    Write-Host 'Created .env from .env.example.'
} else {
    Write-Host 'Found existing .env; preserving its other settings.'
}

$lines = [System.Collections.Generic.List[string]]::new()
Get-Content -LiteralPath $envPath | ForEach-Object { $lines.Add($_) }

function Get-EnvValue {
    param([string]$Name)

    $pattern = '^\s*' + [regex]::Escape($Name) + '\s*=\s*(.*?)\s*$'
    foreach ($line in $lines) {
        if ($line -match $pattern) {
            return (($Matches[1] -split '#', 2)[0]).Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

function Set-EnvValue {
    param(
        [string]$Name,
        [string]$Value
    )

    $pattern = '^\s*' + [regex]::Escape($Name) + '\s*=.*$'
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $pattern) {
            $lines[$i] = "$Name=$Value"
            $found = $true
        }
    }
    if (-not $found) {
        $lines.Add("$Name=$Value")
    }
}

function New-StrongSecret {
    param([int]$Bytes = 32)

    return [Convert]::ToHexString(
        [System.Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)
    ).ToLowerInvariant()
}

$mlToken = Get-EnvValue -Name 'ML_INTERNAL_TOKEN'
if ([string]::IsNullOrWhiteSpace($mlToken) -or
    $mlToken.Length -lt 32 -or
    $mlToken -eq 'brandguard-ml-internal-dev-token') {
    Set-EnvValue -Name 'ML_INTERNAL_TOKEN' -Value (New-StrongSecret -Bytes 32)
    Write-Host 'Generated a strong ML_INTERNAL_TOKEN.'
} else {
    Write-Host 'Kept the existing strong ML_INTERNAL_TOKEN.'
}

$jwtSecret = Get-EnvValue -Name 'JWT_SECRET'
if ([string]::IsNullOrWhiteSpace($jwtSecret) -or
    $jwtSecret -eq 'brandguard-super-secret-jwt-key-change-me-in-production' -or
    $jwtSecret -eq 'brandguard-super-secret-jwt-key-2026' -or
    $jwtSecret.Length -lt 32) {
    Set-EnvValue -Name 'JWT_SECRET' -Value (New-StrongSecret -Bytes 64)
    Write-Host 'Generated a strong JWT_SECRET.'
} else {
    Write-Host 'Kept the existing JWT_SECRET.'
}

Set-Content -LiteralPath $envPath -Value $lines -Encoding utf8
Write-Host ''
Write-Host 'Environment setup complete. Secret values were not printed.'
Write-Host 'Next: docker compose config --quiet; then docker compose up --build -d.'
