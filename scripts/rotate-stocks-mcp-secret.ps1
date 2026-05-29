param(
  [string]$SessionPath = (Join-Path $env:USERPROFILE ".stock-intelligence\session.json"),
  [string]$ServerBase = "https://stock-mcp-sse.azurewebsites.net",
  [string]$PagesProjectName = "sius-ai-workshop"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $SessionPath)) {
  throw "Stocks Intelligence session file not found. Sign in via the VS Code extension first: $SessionPath"
}

$session = Get-Content -LiteralPath $SessionPath -Raw | ConvertFrom-Json
$token = [string]$session.sessionToken

if ([string]::IsNullOrWhiteSpace($token)) {
  throw "sessionToken is missing from $SessionPath. Sign in via the VS Code extension first."
}

Add-Type -AssemblyName System.Net.Http

$client = [System.Net.Http.HttpClient]::new()
$response = $null

try {
  $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, "$ServerBase/sse")
  $request.Headers.Accept.Add([System.Net.Http.Headers.MediaTypeWithQualityHeaderValue]::Parse("text/event-stream"))
  $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $token)

  $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  $statusCode = [int]$response.StatusCode

  if ($statusCode -eq 401 -or $statusCode -eq 403) {
    throw "Current local Stocks Intelligence token is rejected ($statusCode). Sign in via the VS Code extension, then rerun this command."
  }

  if (-not $response.IsSuccessStatusCode) {
    throw "Stocks Intelligence SSE validation failed with HTTP $statusCode. Token was not uploaded."
  }
}
finally {
  if ($null -ne $response) {
    $response.Dispose()
  }
  $client.Dispose()
}

Write-Host "Local Stocks Intelligence token validated. Uploading to Cloudflare Worker secret MCP_BEARER_TOKEN..."
$token | npx wrangler secret put MCP_BEARER_TOKEN --config wrangler.spx.toml

Write-Host "Uploading to Cloudflare Pages secret MCP_BEARER_TOKEN for $PagesProjectName..."
$token | npx wrangler pages secret put MCP_BEARER_TOKEN --project-name $PagesProjectName

Write-Host "Cloudflare secret update commands completed. Token value was not printed."
