#!/usr/bin/env bash
set -euo pipefail

TITLE="${1:-NO_GAS_LABS // EXECUTION RECEIPT}"
BODY="${2:-A claim is not evidence. This artifact was compiled by a GitHub runner.}"
OUT="${3:-out}"
STEP_RAW="${4:-1}"
[[ "$STEP_RAW" =~ ^[0-9]+$ ]] || { echo "population step must be numeric" >&2; exit 4; }
STEP=$(( STEP_RAW > 12 ? 12 : STEP_RAW ))
(( STEP >= 1 )) || STEP=1
mkdir -p "$OUT"

command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg is required" >&2; exit 2; }
FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
test -f "$FONT" || { echo "font missing: $FONT" >&2; exit 3; }

escape_drawtext() {
  printf '%s' "$1" | sed -e "s/'/'\\\\''/g" -e 's/:/\\:/g' -e 's/%/\\%/g'
}
T="$(escape_drawtext "$TITLE")"
B="$(escape_drawtext "$BODY")"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=0x0c0d0b:s=1080x1920:d=12:r=30" \
  -vf "drawtext=fontfile=$FONT:text='$T':fontcolor=0xe8e6dc:fontsize=58:x='70+18*sin(t*2.2)':y='250+10*sin(t*1.3)':enable='lt(t,$STEP)',drawtext=fontfile=$FONT:text='$B':fontcolor=0xc5cdd4:fontsize=34:x=70:y='520+24*sin(t*1.8)':box=1:boxcolor=0x141512@0.85:boxborderw=30:enable='lt(t,$STEP)',drawbox=x=70:y=820:w=$(( (1080-140) * STEP / 12 )):h=18:color=0x9aa39a:t=fill:enable='lt(t,$STEP)',drawtext=fontfile=$FONT:text='ANIMATED TIMELINE  $STEP / 12 SEC':fontcolor=0x9aa39a:fontsize=28:x=70:y=875:enable='lt(t,$STEP)',drawtext=fontfile=$FONT:text='UNPOPULATED // NEXT VERIFIED RUN MUST ADVANCE':fontcolor=0x9aa39a:fontsize=30:x=(w-text_w)/2:y=h/2:enable='gte(t,$STEP)',drawtext=fontfile=$FONT:text='Damien Featherstone // Neophyte Founder // No_Gas_Labs':fontcolor=0x9aa39a:fontsize=27:x=70:y=h-170" \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$OUT/ngl-short.mp4"

sha256sum "$OUT/ngl-short.mp4" | awk '{print $1}' > "$OUT/ngl-short.sha256"
python3 - "$OUT" "$TITLE" "$BODY" "$STEP" <<'PY'
import json, pathlib, sys, hashlib
out=pathlib.Path(sys.argv[1]); p=out/"ngl-short.mp4"; step=int(sys.argv[4])
manifest={
 "schema":"ngl.media.receipt.v2",
 "status":"ANIMATION_COMPLETE_NOT_PUBLISHED" if step == 12 else "ANIMATION_IN_PROGRESS_NOT_PUBLISHED",
 "title":sys.argv[2],"body":sys.argv[3],
 "timeline":{
   "target_seconds":12,
   "populated_seconds":step,
   "remaining_seconds":12-step,
   "progress_basis":"candidate transition from prior canonical state; canonical state advances only after independent workflow verification"
 },
 "artifact":{"path":str(p),"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()},
 "claims":[
   {"claim":"media artifact was compiled","evidence":"artifact hash and successful compiler exit","status":"OBSERVED"},
   {"claim":f"{step} seconds of the 12-second target timeline are populated with animation","evidence":"render parameter and compiled artifact","status":"OBSERVED"},
   {"claim":"canonical NGL runtime state advanced","evidence":None,"status":"UNVERIFIED"},
   {"claim":"12-second animated target is complete","evidence":"populated_seconds == 12" if step == 12 else None,"status":"OBSERVED" if step == 12 else "UNVERIFIED"},
   {"claim":"media artifact was published","evidence":None,"status":"UNVERIFIED"}
 ]}
(out/"receipt.json").write_text(json.dumps(manifest,indent=2)+"\n")
PY

# NGL bounded runtime trigger: canonical state chooses the candidate step.
