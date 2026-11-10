param(
  [Parameter(Mandatory = $true)][string]$Values,   # values.json 경로
  [Parameter(Mandatory = $true)][string]$Out       # 만들 .hwp 경로
)
# values.json → 계약서 .hwp (서식 그대로). 표준출력: WARN … / OK <경로> / ERROR …(종료 코드 1)
$skill = Split-Path -Parent $PSScriptRoot
$cp = "$skill\lib\hwplib-1.1.9.jar;$skill\scripts\koscom-hwp-fill.jar"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
java "-Dfile.encoding=UTF-8" -cp $cp FillRenderer "$skill\templates\pb_addon_contract.hwp" $Values $Out
exit $LASTEXITCODE
