#!/bin/sh
# values.json → 계약서 .hwp (macOS · Linux). 사용: scripts/render.sh values.json 계약서.hwp
skill="$(cd "$(dirname "$0")/.." && pwd)"
exec java -Dfile.encoding=UTF-8 -cp "$skill/lib/hwplib-1.1.9.jar:$skill/scripts/koscom-hwp-fill.jar" FillRenderer "$skill/templates/pb_addon_contract.hwp" "$1" "$2"
