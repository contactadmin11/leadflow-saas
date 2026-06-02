$headers = @{ "Authorization" = "Bearer rnd_9rWxZDaRhcY0uG07mnMsSae7LXcB"; "Accept" = "application/json" }

# List ALL services to find our app
Write-Host "=== ALL RENDER SERVICES ==="
$services = Invoke-RestMethod -Uri "https://api.render.com/v1/services?limit=20&ownerId=tea-d8egjapo3t8c73ferne0" -Headers $headers
foreach ($item in $services) {
    $s = $item.service
    Write-Host "Name: $($s.name) | ID: $($s.id) | Type: $($s.type) | URL: $($s.serviceDetails.url)"
}
