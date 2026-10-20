#!/usr/bin/env bash
# Runs on CI inside an Android emulator: installs the debug APK, opens the
# self-test page (offline OCR on a generated grades table, then on the bundled
# test screenshots) and checks the result.
set -euo pipefail
APK="${1:-android/app/build/outputs/apk/debug/app-debug.apk}"

adb install -r "$APK"
adb logcat -c
adb logcat -G 16M || true
adb shell am start -n com.gcalc.gwa/.MainActivity --ez selftest true

# Up to 20 minutes for the corpus
for _ in $(seq 1 600); do
  if grep -q "GCALC_DONE" <<< "$(adb logcat -d -s GCalc:I)"; then break; fi
  sleep 2
done
LOG="$(adb logcat -d -s GCalc:I)"
echo "----- app log -----"
grep -E "GCALC_" <<< "$LOG" | tail -80 || true

# Results as GitHub annotations (readable without the full log)
{ grep -o 'GCALC_CASE.*' <<< "$LOG" || true; } | while IFS= read -r l; do echo "::notice title=OCR case::$l"; done
{ grep -o 'GCALC_CORPUS_FAIL.*' <<< "$LOG" || true; } | sed -n '1,25p' | while IFS= read -r l; do echo "::warning title=AI corpus::$l"; done
CORPUS="$({ grep -o 'GCALC_CORPUS .*' <<< "$LOG" || true; } | tail -1)"
echo "::notice title=AI corpus::${CORPUS:-no corpus result}"
RESULT="$({ grep -o 'GCALC_SELFTEST.*' <<< "$LOG" || true; } | tail -1)"
if grep -q "GCALC_SELFTEST PASS" <<< "$RESULT"; then
  echo "::notice title=OCR self-test::${RESULT}"
else
  echo "::error title=OCR self-test::${RESULT:-no result within timeout}"
fi

# Screenshot of the normal app for the build artifacts
adb shell am force-stop com.gcalc.gwa
adb shell am start -n com.gcalc.gwa/.MainActivity
sleep 8
adb exec-out screencap -p > android-screen.png || true

grep -q "GCALC_SELFTEST PASS" <<< "$RESULT"
