#!/bin/sh
set -u
umask 077

first_log=$(mktemp)
second_log=$(mktemp)
first_logcat=$(mktemp)
second_logcat=$(mktemp)
cleanup() {
  rm -f "$first_log" "$second_log" "$first_logcat" "$second_logcat"
}
trap cleanup EXIT HUP INT TERM

capture_android_logcat() {
  output_file=$1
  adb logcat -d -v threadtime -t 2500 >"$output_file" 2>&1 || true
}

collect_android_diagnostics() {
  label=$1
  logcat_file=$2
  printf '\n=== Android emulator diagnostics: %s ===\n' "$label"
  if ! command -v adb >/dev/null 2>&1; then
    printf 'adb is unavailable; emulator diagnostics could not be collected.\n'
    return 0
  fi

  printf '\n--- adb devices -l ---\n'
  adb devices -l 2>&1 || true

  # Keep runner output bounded while retaining the full bounded logcat in a
  # temporary file for conservative failure classification.
  printf '\n--- crash-relevant logcat (last 2500 lines, at most 250 matches) ---\n'
  if [ -f "$logcat_file" ]; then
    grep -E -i 'FATAL EXCEPTION|Fatal signal|SIGSEGV|AndroidRuntime|Process .*died|chromium|WebView|ColorBuffer|EGL|OpenGL|SurfaceFlinger|libc|ActivityManager|ActivityTaskManager|labs\.nogas\.commonground' "$logcat_file" \
      | tail -n 250 || true
  else
    printf 'No logcat capture was preserved.\n'
  fi

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

has_single_empty_instrumentation_failure() {
  report_root='android/app/build/outputs/androidTest-results/connected'
  [ -d "$report_root" ] || return 1
  python3 - "$report_root" <<'PY'
import glob
import os
import sys
import xml.etree.ElementTree as ET

paths = glob.glob(os.path.join(sys.argv[1], "**", "*.xml"), recursive=True)
if not paths:
    raise SystemExit(1)

failures = []
errors = []
for path in paths:
    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError):
        raise SystemExit(1)
    for node in root.iter():
        tag = node.tag.rsplit("}", 1)[-1]
        if tag == "failure":
            failures.append(node)
        elif tag == "error":
            errors.append(node)

if len(failures) != 1 or errors:
    raise SystemExit(1)
failure = failures[0]
if (failure.text or "").strip() or list(failure):
    raise SystemExit(1)
if any(str(value).strip() for value in failure.attrib.values()):
    raise SystemExit(1)
raise SystemExit(0)
PY
}

wait_for_gms_provider() {
  attempt_limit=\${NGL_ANDROID_GMS_PROVIDER_PROBE_ATTEMPTS:-15}
  delay_seconds=\${NGL_ANDROID_GMS_PROVIDER_PROBE_DELAY_SECONDS:-2}
  case "$attempt_limit" in
    ''|*[!0-9]*) printf 'Invalid Google Play services probe attempt limit.\n' >&2; return 2 ;;
  esac
  case "$delay_seconds" in
    ''|*[!0-9]*) printf 'Invalid Google Play services probe delay.\n' >&2; return 2 ;;
  esac
  if [ "$attempt_limit" -le 0 ] || [ "$attempt_limit" -gt 30 ] || [ "$delay_seconds" -gt 10 ]; then
    printf 'Google Play services probe limits exceed the bounded range.\n' >&2
    return 2
  fi

  attempt=1
  while [ "$attempt" -le "$attempt_limit" ]; do
    provider_pid="$(adb shell pidof com.google.android.gms.persistent 2>/dev/null | tr -d '\r' || true)"
    if printf '%s\n' "$provider_pid" | grep -Eq '(^|[[:space:]])[0-9]+([[:space:]]|$)'; then
      printf 'Google Play services provider process ready after %s probe(s).\n' "$attempt"
      return 0
    fi
    if [ "$attempt" -lt "$attempt_limit" ]; then
      sleep "$delay_seconds"
    fi
    attempt=$((attempt + 1))
  done

  printf 'Google Play services provider process did not recover after %s probe(s).\n' "$attempt_limit" >&2
  return 1
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
# Preserve the first attempt's bounded logcat and XML before deciding whether a
# single retry is justified by one of the two narrowly observed failure classes.
capture_android_logcat "$first_logcat"
collect_android_diagnostics "first instrumentation attempt" "$first_logcat"

retry_reason=''
# Retry only the two observed emulator-side split-APK installation failures,
# and only when the installer failed before any instrumentation test ran.
if grep -Fq 'Finished 0 tests on test(AVD)' "$first_log" &&
   grep -Fq 'Failed to install split APK(s)' "$first_log"; then
  if grep -Fq 'INSTALL_FAILED_VERIFICATION_FAILURE' "$first_log" &&
     grep -Fq 'Integrity verification timed out' "$first_log"; then
    retry_reason='split-APK integrity verification timeout'
  elif grep -Fq "cmd: Can't find service: package" "$first_log"; then
    retry_reason='Package Manager service disappearance during split-APK installation'
  fi
fi

# A separate, post-start retry is allowed only when logcat directly records
# Android killing this app because its Google Play services module provider
# died, instrumentation reports a process crash, and the sole XML failure is
# empty. Any assertion body, Java/native fatal, ANR, OOM, or other failure
# remains fail-closed and is never retried.
if [ -z "$retry_reason" ] &&
   grep -Fq 'Test run failed to complete. Instrumentation run failed due to Process crashed.' "$first_log" &&
   grep -Fq 'depends on provider com.google.android.gms/.chimera.container.GmsModuleProvider in dying proc com.google.android.gms.persistent' "$first_logcat" &&
   grep -Fq 'Crash of app labs.nogas.commonground running instrumentation' "$first_logcat" &&
   ! grep -E -i -q 'FATAL EXCEPTION|Fatal signal|SIGSEGV|SIGABRT|ANR in|OutOfMemoryError|lmkd.*(kill|killed)' "$first_logcat" &&
   has_single_empty_instrumentation_failure; then
  retry_reason='Google Play services provider death during instrumentation'
fi

if [ -z "$retry_reason" ]; then
  exit "$first_status"
fi

printf 'Detected %s before any instrumentation test executed; retrying once after a bounded Package Manager readiness probe.\n' "$retry_reason"
if ! sh scripts/wait-for-android-package-manager.sh; then
  printf 'Package Manager did not recover; instrumentation will not be retried.\n' >&2
  exit "$first_status"
fi
if [ "$retry_reason" = 'Google Play services provider death during instrumentation' ] &&
   ! wait_for_gms_provider; then
  printf 'Google Play services provider did not recover; instrumentation will not be retried.\n' >&2
  exit "$first_status"
fi

if run_instrumentation "$second_log"; then
  exit 0
else
  second_status=$?
fi

printf 'Android instrumentation retry failed; no further retry will be attempted.\n' >&2
capture_android_logcat "$second_logcat"
collect_android_diagnostics "one permitted retry" "$second_logcat"
exit "$second_status"
