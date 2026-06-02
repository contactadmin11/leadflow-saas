$headers = @{
    "Authorization" = "Bearer rnd_9rWxZDaRhcY0uG07mnMsSae7LXcB"
    "Accept"        = "application/json"
}
$envVars = Invoke-RestMethod -Uri "https://api.render.com/v1/services/srv-d8ek2v4m0tmc73eubh3g/env-vars" -Headers $headers
foreach ($ev in $envVars) {
    if ($ev.envVar.key -eq "MONGODB_URI") {
        Write-Host "FULL MONGODB_URI:"
        Write-Host $ev.envVar.value
    }
}
