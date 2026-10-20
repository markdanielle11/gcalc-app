#!/usr/bin/env bash
# Runs on CI inside an Android emulator: installs the debug APK, opens the
# self-test page (offline OCR on a generated grades table) and checks the result.
set -euo pipefail
APK="${1:-android/app/build/outputs/apk/debug/app-debug.apk}"

adb install -r "$APK"
adb logcat -c
adb shell am start -n com.gcalc.gwa/.MainActivity --ez selftest true

for _ in $(seq 1 150); do
  if adb logcat -d -s GCalc:I | grep -q "GCALC_SELFTEST"; then break; fi
  sleep 2
done
echo "----- app log -----"
adb logcat -d -s GCalc:I | tail -40
# Surface the result as a GitHub annotation (readable without the full log)
adb logcat -d -s GCalc:I | grep -o 'GCALC_CASE.*' | while IFS= read -r l; do echo "::notice title=OCR case::$l"; done
RESULT="$(adb logcat -d -s GCalc:I | grep -o 'GCALC_SELFTEST.*' | tail -1 || true)"
if echo "$RESULT" | grep -q "GCALC_SELFTEST PASS"; then
  echo "::notice title=OCR self-test::${RESULT:-no result}"
else
  echo "::error title=OCR self-test::${RESULT:-no result within timeout}"
  adb logcat -d -s GCalc:I | tail -15 | while IFS= read -r l; do echo "::warning title=app log::$l"; done
fi

# Screenshot of the normal app for the build artifacts
adb shell am force-stop com.gcalc.gwa
adb shell am start -n com.gcalc.gwa/.MainActivity
sleep 8
adb exec-out screencap -p > android-screen.png || true

adb logcat -d -s GCalc:I | grep -q "GCALC_SELFTEST PASS"
