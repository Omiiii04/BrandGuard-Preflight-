$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot '.env'
$logPath = Join-Path $env:TEMP ("brandguard-verification-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".log")

function Read-EnvValue {
    param([string]$Name)

    $pattern = '^\s*' + [regex]::Escape($Name) + '\s*=\s*(.*?)\s*$'
    foreach ($line in (Get-Content -LiteralPath $envPath)) {
        if ($line -match $pattern) {
            $value = (($Matches[1] -split '#', 2)[0]).Trim().Trim('"').Trim("'")
            return $value
        }
    }
    return ''
}

function Invoke-CheckedNativeCommand {
    param(
        [string]$Label,
        [scriptblock]$Command
    )

    Write-Host ''
    Write-Host "== $Label ==" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

$composeEnvNames = @(
    'ML_INTERNAL_TOKEN', 'JWT_SECRET', 'MONGODB_URI',
    'WEB_PORT', 'API_PORT', 'ML_PORT', 'MONGO_PORT',
    'MINIO_PORT', 'MINIO_CONSOLE_PORT', 'MINIO_ROOT_USER',
    'MINIO_ROOT_PASSWORD', 'ML_SERVICE_URL', 'NODE_ENV', 'DEMO_MODE', 'API_URL', 'ML_URL'
)
$previousEnvironment = @{}
foreach ($name in $composeEnvNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

Push-Location $repoRoot
try {
    & (Join-Path $PSScriptRoot 'setup-env.ps1')

    # Make Compose consume the freshly validated values from this repository's
    # .env, even if this PowerShell session already has stale variables set.
    foreach ($name in $composeEnvNames) {
        Remove-Item ("Env:" + $name) -ErrorAction SilentlyContinue
    }

    $env:ML_INTERNAL_TOKEN = Read-EnvValue -Name 'ML_INTERNAL_TOKEN'
    $env:JWT_SECRET = Read-EnvValue -Name 'JWT_SECRET'
    $env:MONGODB_URI = Read-EnvValue -Name 'MONGODB_URI'
    $env:WEB_PORT = Read-EnvValue -Name 'WEB_PORT'
    $env:API_PORT = Read-EnvValue -Name 'API_PORT'
    $env:ML_PORT = Read-EnvValue -Name 'ML_PORT'
    $env:MONGO_PORT = Read-EnvValue -Name 'MONGO_PORT'
    $env:MINIO_PORT = Read-EnvValue -Name 'MINIO_PORT'
    $env:MINIO_CONSOLE_PORT = Read-EnvValue -Name 'MINIO_CONSOLE_PORT'
    $env:MINIO_ROOT_USER = Read-EnvValue -Name 'MINIO_ROOT_USER'
    $env:MINIO_ROOT_PASSWORD = Read-EnvValue -Name 'MINIO_ROOT_PASSWORD'
    $env:ML_SERVICE_URL = Read-EnvValue -Name 'ML_SERVICE_URL'
    $env:NODE_ENV = Read-EnvValue -Name 'NODE_ENV'
    $env:DEMO_MODE = Read-EnvValue -Name 'DEMO_MODE'

    if (-not (Test-Path (Join-Path $repoRoot 'backend/node_modules/mongoose'))) {
        Invoke-CheckedNativeCommand -Label 'Install backend integration dependencies' -Command {
            npm ci --prefix backend
        }
    }

    Invoke-CheckedNativeCommand -Label 'Validate Docker Compose configuration' -Command {
        docker compose config --quiet
    }

    Invoke-CheckedNativeCommand -Label 'Build and start all services' -Command {
        docker compose up --build -d --wait --wait-timeout 300
    }

    $apiPort = Read-EnvValue -Name 'API_PORT'
    if (-not $apiPort) { $apiPort = '4000' }
    $mlPort = Read-EnvValue -Name 'ML_PORT'
    if (-not $mlPort) { $mlPort = '8000' }
    $mongoPort = Read-EnvValue -Name 'MONGO_PORT'
    if (-not $mongoPort) { $mongoPort = '27017' }

    $env:API_URL = "http://localhost:$apiPort"
    $env:ML_URL = "http://localhost:$mlPort"
    $configuredMongoUri = Read-EnvValue -Name 'MONGODB_URI'
    if ($configuredMongoUri -match '^mongodb://mongo(?::|/)') {
        # The Compose-only hostname "mongo" must become localhost for host-run test clients.
        $env:MONGODB_URI = "mongodb://localhost:$mongoPort/brandguard"
    } elseif ($configuredMongoUri) {
        # Preserve an explicitly configured external MongoDB URI.
        $env:MONGODB_URI = $configuredMongoUri
    } else {
        $env:MONGODB_URI = "mongodb://localhost:$mongoPort/brandguard"
    }

    Invoke-CheckedNativeCommand -Label 'Run source upload and draft review integration test' -Command {
        node integration_test.js
    }

    Invoke-CheckedNativeCommand -Label 'Restart ML service' -Command {
        docker compose restart ml
    }

    Write-Host ''
    Write-Host '== Wait for ML health after restart ==' -ForegroundColor Cyan
    $healthy = $false
    for ($attempt = 1; $attempt -le 60; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri "$($env:ML_URL)/health" -TimeoutSec 3
            if ($response.status -eq 'healthy') {
                $healthy = $true
                break
            }
        } catch {
            # The service is expected to be briefly unavailable during restart.
        }
        Start-Sleep -Seconds 2
    }
    if (-not $healthy) {
        throw 'ML service did not become healthy after restart.'
    }
    Write-Host 'ML service is healthy.'

    Invoke-CheckedNativeCommand -Label 'Verify indexed evidence survives ML restart' -Command {
        node scripts/verify-ml-persistence.js
    }

    Write-Host ''
    Write-Host 'SUCCESS: full-stack integration and persistence verification passed.' -ForegroundColor Green
    Write-Host 'The Docker Compose services remain running. Persistent volumes were not deleted.'
} catch {
    try {
        docker compose logs --no-color *> $logPath
        Write-Host "Compose logs saved to: $logPath" -ForegroundColor Yellow
    } catch {
        Write-Host 'Could not collect Compose logs.' -ForegroundColor Yellow
    }
    throw
} finally {
    foreach ($name in $composeEnvNames) {
        $value = $previousEnvironment[$name]
        if ($null -eq $value) {
            Remove-Item ("Env:" + $name) -ErrorAction SilentlyContinue
        } else {
            Set-Item ("Env:" + $name) -Value $value
        }
    }
    Pop-Location
}
