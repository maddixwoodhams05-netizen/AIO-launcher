// Closes a running game by closing every program that lives in its folder.
// It first asks the game nicely (like clicking the X on its window), and if
// it is still open after a few seconds, ends it (like Task Manager does).
const { execFile } = require('child_process');

const SCRIPT = `
$dir = $env:GAME_DIR.TrimEnd('\\') + '\\'
$ids = @(Get-CimInstance Win32_Process |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) } |
  ForEach-Object { $_.ProcessId })
if ($ids.Count -eq 0) { exit }
foreach ($id in $ids) { try { (Get-Process -Id $id -ErrorAction Stop).CloseMainWindow() | Out-Null } catch {} }
$deadline = (Get-Date).AddSeconds(8)
while ((Get-Date) -lt $deadline -and (Get-Process -Id $ids -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 500 }
Get-Process -Id $ids -ErrorAction SilentlyContinue | Stop-Process -Force
`;

function closeGame(gameDir) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !gameDir) return resolve();
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      { windowsHide: true, timeout: 30000, env: { ...process.env, GAME_DIR: gameDir } },
      () => resolve()
    );
  });
}

module.exports = { closeGame };
