$ProgressPreference = 'SilentlyContinue'
$dest = "$env:USERPROFILE\gh-cli"
$zip  = "$env:USERPROFILE\gh.zip"

Write-Host "Getting latest GitHub CLI version..."
$rel   = Invoke-RestMethod -Uri "https://api.github.com/repos/cli/cli/releases/latest" -UseBasicParsing
$ver   = $rel.tag_name  # e.g. "v2.50.0"
$asset = $rel.assets | Where-Object { $_.name -like "*windows_amd64.zip*" } | Select-Object -First 1
$url   = $asset.browser_download_url
Write-Host "Version: $ver  URL: $url"

Write-Host "Downloading GitHub CLI..."
& curl.exe -L -o $zip $url --retry 3
$size = (Get-Item $zip).Length
Write-Host "Downloaded: $([math]::Round($size/1MB,1)) MB"
if ($size -lt 1000000) { Write-Host "ERROR: Download incomplete"; exit 1 }

Write-Host "Extracting..."
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Expand-Archive -Path $zip -DestinationPath $dest -Force
Remove-Item $zip -Force

# Find the gh.exe (it's inside a versioned subfolder)
$ghExe = Get-ChildItem -Path $dest -Recurse -Filter "gh.exe" | Select-Object -First 1
Write-Host "Found: $($ghExe.FullName)"

# Add to PATH
$binDir = $ghExe.DirectoryName
$current = [System.Environment]::GetEnvironmentVariable("Path","User")
if ($current -notlike "*$binDir*") {
    [System.Environment]::SetEnvironmentVariable("Path","$current;$binDir","User")
}
$env:Path += ";$binDir"

Write-Host "Verifying..."
& $ghExe.FullName --version
Write-Host "GH_INSTALL_SUCCESS"
