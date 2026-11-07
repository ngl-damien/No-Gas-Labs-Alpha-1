#!/bin/sh
set -u
umask 077

first_log=$(mktemp)
second_log=$(mktemp)
cleanup() {
  rm -f "$first_log" "$second_log"
}
trap cleanup EXIT HUP INT TERM

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
exit "$second_status"
