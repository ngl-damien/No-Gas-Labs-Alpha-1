#!/bin/sh
set -u
umask 077

first_log=$(mktemp)
second_log=$(mktemp)
cleanup() {
  rm -f "$first_log" "$second_log"
}
trap cleanup EXIT HUP INT TERM

collect_android_diagnostics() {
  label=$1
  printf '\n=== Android emulator diagnostics: %s ===\n' "$label"
  if ! command -v adb >/dev/null 2>&1; then
    printf 'adb is unavailable; emulator diagnostics could not be collected.\n'
    return 0
  fi

  printf '\n--- adb devices -l ---\n'
  adb devices -l 2>&1 || true

  # Keep runner output bounded while preserving process, WebView and emulator-GPU failures.
  printf '\n--- crash-relevant logcat (last 2500 lines, at most 250 matches) ---\n'
  adb logcat -d -v threadtime -t 2500 2>&1 \
    | grep -E -i 'FATAL EXCEPTION|Fatal signal|SIGSEGV|AndroidRuntime|Process .*died|chromium|WebView|ColorBuffer|EGL|OpenGL|SurfaceFlinger|libc|ActivityTaskManager|labs\.nogas\.commonground' \
    | tail -n 250 || true

  printf '\n--- connected Android test XML summaries ---\n'
  report_root='android/app/build/outputs/androidTest-results/connected'
  if [ -d "$report_root" ]; then
    find "$report_root" -type f -name '*.xml' -print
    find "$report_root" -type f -name '*.xml' \
      -exec grep -H -E '<(testsuite|testcase|failure|error)' {} \; 2>/dev/null \
      | tail -n 100 || true
  else
    printf 'No connected Android test XML was produced.\n'
  fi
}

run_instrumentation() {
  output_file=$1
  if gradle -p android :app:connectedDebugAndroidTest >"$output_file" 2>&1; then
    cat "$output_file"
    return 0
  else
    status=$?
    cat "$output_file"
    return "$status"
  fi
}

if run_instrumentation "$first_log"; then
  exit 0
else
  first_status=$?
fi
# Preserve evidence for renderer, emulator or instrumentation-process failures.
# Only the narrowly identified pre-test split-APK install failures below are retried.
collect_android_diagnostics "first instrumentation attempt"

# Retry only the two observed emulator-side split-APK installation failures,
# and only when the installer failed before any instrumentation test ran.
retry_reason=''
if grep -Fq 'Finished 0 tests on test(AVD)' "$first_log" &&
   grep -Fq 'Failed to install split APK(s)' "$first_log"; then
  if grep -Fq 'INSTALL_FAILED_VERIFICATION_FAILURE' "$first_log" &&
     grep -Fq 'Integrity verification timed out' "$first_log"; then
    retry_reason='split-APK integrity verification timeout'
  elif grep -Fq "cmd: Can't find service: package" "$first_log"; then
    retry_reason='Package Manager service disappearance during split-APK installation'
  fi
fi
if [ -z "$retry_reason" ]; then
  exit "$first_status"
fi

printf 'Detected %s before any instrumentation test executed; retrying once after a bounded Package Manager readiness probe.\n' "$retry_reason"
if ! sh scripts/wait-for-android-package-manager.sh; then
  printf 'Package Manager did not recover; instrumentation will not be retried.\n' >&2
  exit "$first_status"
fi

if run_instrumentation "$second_log"; then
  exit 0
else
  second_status=$?
fi

printf 'Android instrumentation retry failed; no further retry will be attempted.\n' >&2
collect_android_diagnostics "one permitted retry"
exit "$second_status"
