$ProgressPreference = 'SilentlyContinue'
$dest = "$env:USERPROFILE\flyctl"
$zip  = "$env:USERPROFILE\flyctl.zip"

# Get the real latest version number first
Write-Host "Getting latest version..."
try {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/superfly/flyctl/releases/latest" -UseBasicParsing
    $ver = $rel.tag_name  # e.g. "v0.3.134"
    $asset = $rel.assets | Where-Object { $_.name -like "*Windows_x86_64*" } | Select-Object -First 1
    $url = $asset.browser_download_url
} catch {
    # Fallback to known stable version
    $ver = "v0.3.130"
    $url = "https://github.com/superfly/flyctl/releases/download/$ver/flyctl_0.3.130_Windows_x86_64.zip"
}
Write-Host "Version: $ver"
Write-Host "URL: $url"

# Use curl.exe (built into Windows 10/11) — more reliable than Invoke-WebRequest
Write-Host "Downloading with curl.exe..."
$curlResult = & curl.exe -L -o $zip $url --retry 3 --retry-delay 2
if ($LASTEXITCODE -ne 0) {
    Write-Host "curl failed, trying Invoke-WebRequest..."
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
}

# Check file size
$size = (Get-Item $zip).Length
Write-Host "Downloaded: $([math]::Round($size/1MB,1)) MB"

if ($size -lt 1000000) {
    Write-Host "ERROR: File too small - download incomplete"
    exit 1
}

Write-Host "Extracting..."
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Expand-Archive -Path $zip -DestinationPath $dest -Force
Remove-Item $zip -Force

Write-Host "Adding to PATH..."
$current = [System.Environment]::GetEnvironmentVariable("Path","User")
if ($current -notlike "*$dest*") {
    [System.Environment]::SetEnvironmentVariable("Path","$current;$dest","User")
}
$env:Path += ";$dest"

Write-Host "Verifying..."
& "$dest\flyctl.exe" version
Write-Host ""
Write-Host "FLYCTL_INSTALL_SUCCESS"
