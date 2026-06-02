$headers = @{
    "Authorization" = "Bearer rnd_9rWxZDaRhcY0uG07mnMsSae7LXcB"
    "Accept"        = "application/json"
}
$envVars = Invoke-RestMethod -Uri "https://api.render.com/v1/services/srv-d8ek2v4m0tmc73eubh3g/env-vars" -Headers $headers
foreach ($ev in $envVars) {
    if ($ev.envVar.key -eq "ADMIN_JWT_SECRET") {
        $val = $ev.envVar.value
        Write-Host "Full ADMIN_JWT_SECRET: $val"
        Write-Host "Length: $($val.Length)"
        Write-Host "First 16 chars: $($val.Substring(0, [Math]::Min(16, $val.Length)))"
        Write-Host "First 12 chars: $($val.Substring(0, [Math]::Min(12, $val.Length)))"
    }
}
