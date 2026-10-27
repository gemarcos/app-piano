#!/usr/bin/env bash
# Generates the synthetic piano-like fixtures + ground truth used by check-transcription.mjs.
# Needs sox and ffmpeg. Output: test/fixtures/{scale,chords,melody-bass}.{wav,json}, scale.mp4, silence.wav
# Timbre: sox "pluck" (sharp attack, natural decay) with a short damper-like release and a gentle low-pass.
set -euo pipefail
export LC_ALL=C # "." decimals for printf/awk/sort regardless of the user locale

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/test/fixtures"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

SR=44100
LEAD=0.5 # silence before the first note, seconds
TAIL=0.8 # silence after the last note, seconds
SOX=(sox -R -D -q) # repeatable (fixed seeds), no dither, quiet

# render_voice <id> <bpm> <gain> <MIDI:BEATS>...   (MIDI 0 = rest)
# Writes $WORK/<id>.wav (monophonic line) and "pitch start duration" lines to $WORK/<id>.truth.
render_voice() {
  local id=$1 bpm=$2 gain=$3
  shift 3
  local beat=0 i=0 parts=()
  : >"$WORK/$id.truth"
  "${SOX[@]}" -r $SR -c 1 -n -b 16 "$WORK/$id-lead.wav" trim 0 $LEAD
  parts+=("$WORK/$id-lead.wav")
  for item in "$@"; do
    local midi=${item%%:*} beats=${item##*:} start dur n
    # Sample-exact boundaries so long lines do not drift.
    read -r start dur n <<<"$(awk -v b0="$beat" -v b="$beats" -v bpm="$bpm" -v lead=$LEAD -v sr=$SR 'BEGIN {
      s = lead + b0 * 60 / bpm; e = lead + (b0 + b) * 60 / bpm
      printf "%.6f %.6f %d", s, e - s, int(e * sr + 0.5) - int(s * sr + 0.5) }')"
    local f="$WORK/$id-$i.wav"
    if [ "$midi" -eq 0 ]; then
      "${SOX[@]}" -r $SR -c 1 -n -b 16 "$f" trim 0 "${n}s"
    else
      "${SOX[@]}" -r $SR -c 1 -n -b 16 "$f" synth "${n}s" pluck "%$((midi - 69))" fade q 0.004 "${n}s" 0.06 vol "$gain"
      echo "$midi $start $dur" >>"$WORK/$id.truth"
    fi
    parts+=("$f")
    i=$((i + 1))
    beat=$(awk -v a="$beat" -v b="$beats" 'BEGIN { printf "%.6f", a + b }')
  done
  "${SOX[@]}" "${parts[@]}" "$WORK/$id.wav"
}

# mix_fixture <name> <bpm> <voice ids...>: mixes voices, writes <name>.wav + <name>.json (ground truth).
mix_fixture() {
  local name=$1 bpm=$2
  shift 2
  local inputs=() truths=()
  for v in "$@"; do
    inputs+=(-v 1 "$WORK/$v.wav")
    truths+=("$WORK/$v.truth")
  done
  if [ $# -gt 1 ]; then
    "${SOX[@]}" -m "${inputs[@]}" "$WORK/$name-mix.wav"
  else
    cp "$WORK/$1.wav" "$WORK/$name-mix.wav"
  fi
  "${SOX[@]}" "$WORK/$name-mix.wav" -r $SR -c 1 -b 16 "$OUT/$name.wav" lowpass 3000 pad 0 $TAIL norm -1
  local total
  total=$(soxi -D "$OUT/$name.wav")
  sort -k2,2n -k1,1n "${truths[@]}" | awk -v name="$name" -v bpm="$bpm" -v total="$total" '
    BEGIN { printf "{\n  \"name\": \"%s\",\n  \"bpm\": %s,\n  \"duration\": %.3f,\n  \"notes\": [", name, bpm, total }
    { printf "%s\n    { \"pitch\": %d, \"start\": %.4f, \"duration\": %.4f }", (NR > 1 ? "," : ""), $1, $2, $3 }
    END { printf "\n  ]\n}\n" }' >"$OUT/$name.json"
  echo "  $name.wav  $(printf '%.2f' "$total") s, $(grep -c pitch "$OUT/$name.json") notes"
}

echo "Generating fixtures in $OUT"

# 1. C major scale C4..C5, quarter notes at 100 BPM.
render_voice scale 100 0.6 60:1 62:1 64:1 65:1 67:1 69:1 71:1 72:1
mix_fixture scale 100 scale

# 2. Block triads C-F-G-C (twice) in half notes at 90 BPM, with bass notes.
render_voice ch-top 90 0.25 67:2 69:2 67:2 67:2 67:2 69:2 67:2 67:2
render_voice ch-mid 90 0.25 64:2 65:2 62:2 64:2 64:2 65:2 62:2 64:2
render_voice ch-low 90 0.25 60:2 60:2 59:2 60:2 60:2 60:2 59:2 60:2
render_voice ch-bass 90 0.3 48:2 41:2 43:2 48:2 48:2 41:2 43:2 48:2
mix_fixture chords 90 ch-top ch-mid ch-low ch-bass

# 3. G major: melody in eighths over a bass line in quarters, 110 BPM, 4 bars (~8.7 s of music).
render_voice mb-melody 110 0.5 \
  74:0.5 72:0.5 71:0.5 69:0.5 67:0.5 69:0.5 71:0.5 74:0.5 \
  76:0.5 74:0.5 72:0.5 71:0.5 69:0.5 71:0.5 72:0.5 76:0.5 \
  78:0.5 76:0.5 74:0.5 72:0.5 71:0.5 72:0.5 69:0.5 66:0.5 \
  67:0.5 71:0.5 74:0.5 79:0.5 74:0.5 71:0.5 67:0.5 67:0.5
render_voice mb-bass 110 0.4 \
  43:1 50:1 47:1 50:1 \
  48:1 55:1 52:1 55:1 \
  50:1 57:1 54:1 57:1 \
  43:1 47:1 50:1 43:1
mix_fixture melody-bass 110 mb-melody mb-bass

# 4. The scale inside a video container (H.264 + AAC).
ffmpeg -nostdin -y -loglevel error \
  -f lavfi -i "color=c=0xEEEEF5:s=320x240:r=24" -i "$OUT/scale.wav" \
  -shortest -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart \
  "$OUT/scale.mp4"
echo "  scale.mp4  $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/scale.mp4" | xargs printf '%.2f') s (H.264 + AAC)"

# 5. Near-silence (quiet pink noise): should produce (almost) no notes.
"${SOX[@]}" -r $SR -c 1 -n -b 16 "$OUT/silence.wav" synth 3 pinknoise vol 0.003
echo "  silence.wav 3.00 s"

# 6. "Room" variants (same ground truth): phone-like low cut, reverb and background noise (~26 dB SNR).
#    Used to keep the threshold calibration from overfitting the clean synthetic audio.
room_variant() {
  local name=$1 dur
  dur=$(soxi -D "$OUT/$name.wav")
  "${SOX[@]}" -r $SR -c 1 -n -b 16 "$WORK/$name-noise.wav" synth "$dur" pinknoise vol 0.04
  "${SOX[@]}" "$OUT/$name.wav" "$WORK/$name-wet.wav" highpass 120 reverb 45 50 70 lowpass 6000
  "${SOX[@]}" -m -v 1 "$WORK/$name-wet.wav" -v 1 "$WORK/$name-noise.wav" -b 16 "$OUT/$name-room.wav" norm -1
  sed "s/\"name\": \"$name\"/\"name\": \"$name-room\"/" "$OUT/$name.json" >"$OUT/$name-room.json"
  echo "  $name-room.wav  $(printf '%.2f' "$dur") s"
}
room_variant chords
room_variant melody-bass
