param(
  [Parameter(Mandatory = $true)][string]$File,   # 확인할 .xlsx
  [Parameter(Mandatory = $true)][string]$OutDir, # 캡처 PNG를 저장할 폴더
  [int]$Zoom = 60,                               # 한 화면에 한 쪽이 들어오게 줄여서 본다. 0이면 사본 없이 저장된 보기 그대로 연다
  [int]$Wait = 40
)
# 엑셀로 파일을 열어 창만 캡처한다(Windows + Excel). 원본은 건드리지 않고, 임시 사본(배율만 줄임)을 읽기 전용으로 열었다가 지운다.
# 사본을 여는 까닭: 엑셀이 제대로 닫히지 않으면 연 파일이 「문서 복구」 목록에 남는데, 사본은 지우면 목록에서도 사라진다.
# 데스크톱 전체는 찍지 않는다. Claude Code에서는 샌드박스 밖에서 실행해야 엑셀 창이 보인다.
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class XV {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool rp);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public struct R { public int L, T, Rt, B; }
  public static IntPtr Find(string cls, string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => { var c = new StringBuilder(256); var t = new StringBuilder(512); GetClassName(h, c, 256); GetWindowText(h, t, 512);
      if (IsWindowVisible(h) && c.ToString() == cls && t.ToString().Contains(title)) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
}
"@
$excel = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\excel.exe' -ErrorAction SilentlyContinue).'(default)'
if (-not $excel -or -not (Test-Path $excel)) { "SKIP 엑셀이 없음 — scripts/show.py로 글만 확인한다"; exit 2 }
$src = (Resolve-Path $File).Path
$tag = "kq" + [Guid]::NewGuid().ToString("N").Substring(0, 8)
$tmp = Join-Path $env:TEMP ($tag + [IO.Path]::GetExtension($src))
$py = @"
import sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
for ws in wb.worksheets:
    ws.sheet_view.view = 'normal'
    ws.sheet_view.zoomScale = ws.sheet_view.zoomScaleNormal = int(sys.argv[3])
wb.save(sys.argv[2])
"@
if ($Zoom -gt 0) {
  $py | python - $src $tmp $Zoom
  if (-not (Test-Path $tmp)) { "FAIL`t임시 사본을 만들지 못함(python · openpyxl 확인)"; exit 1 }
} else { Copy-Item -LiteralPath $src -Destination $tmp }
$proc = Start-Process -FilePath $excel -ArgumentList "/x", "/r", "`"$tmp`"" -PassThru
$h = [IntPtr]::Zero
for ($i = 0; $i -lt $Wait -and $h -eq [IntPtr]::Zero; $i++) { Start-Sleep -Seconds 1; $h = [XV]::Find("XLMAIN", $tag) }
if ($h -eq [IntPtr]::Zero) {
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  "FAIL`t$([IO.Path]::GetFileName($src))`t(엑셀 창이 뜨지 않음 — -Wait 값을 늘리거나 엑셀에서 직접 연다)"; exit 1
}
"OK`t$([IO.Path]::GetFileName($src))"
New-Item -ItemType Directory -Force $OutDir | Out-Null
[XV]::ShowWindow($h, 1) | Out-Null
[XV]::MoveWindow($h, 0, 0, 1000, 1040, $true) | Out-Null
Start-Sleep -Seconds 3
$r = New-Object XV+R; [XV]::GetWindowRect($h, [ref]$r) | Out-Null
$bmp = New-Object System.Drawing.Bitmap ($r.Rt - $r.L), ($r.B - $r.T)
$g = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc()
[XV]::PrintWindow($h, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc); $g.Dispose()
$png = Join-Path $OutDir (([IO.Path]::GetFileNameWithoutExtension($src)) + ".png")
if (Test-Path $png) { [IO.File]::Delete($png) }    # 예전 캡처를 보고 오판하지 않게 먼저 지운다
$bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
"SAVED`t$png"
# 이 스크립트가 띄운 엑셀만 닫는다(/x로 따로 띄운 프로세스). 쓰던 엑셀 창에 열렸으면 손대지 않는다
$owner = [XV]::Pid($h)
if ($owner -eq $proc.Id) {
  [XV]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null       # 먼저 정상 종료를 청한다
  for ($t = 0; $t -lt 10 -and -not $proc.HasExited; $t++) { Start-Sleep -Milliseconds 500 }
  if (-not $proc.HasExited) { Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 800 }
} else { "NOTE`t사본이 이미 떠 있던 엑셀에 열렸습니다 — 그 창은 닫지 않았으니 직접 닫아 주세요" }
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
exit 0
