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

# Retry only the observed emulator-side split-APK verifier timeout, and only
# when the installer failed before any instrumentation test actually ran.
if ! grep -Fq 'INSTALL_FAILED_VERIFICATION_FAILURE' "$first_log" ||
   ! grep -Fq 'Integrity verification timed out' "$first_log" ||
   ! grep -Fq 'Finished 0 tests on test(AVD)' "$first_log"; then
  exit "$first_status"
fi

printf 'Detected split-APK integrity verification timeout before any instrumentation test executed; retrying once after a bounded Package Manager readiness probe.\n'
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
