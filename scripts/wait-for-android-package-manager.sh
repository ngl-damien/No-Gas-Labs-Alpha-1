#!/bin/sh
set -u

attempt_limit=${NGL_ANDROID_PACKAGE_PROBE_ATTEMPTS:-30}
delay_seconds=${NGL_ANDROID_PACKAGE_PROBE_DELAY_SECONDS:-2}

case "$attempt_limit" in
  ''|*[!0-9]*) printf 'Invalid Package Manager probe attempt limit.\\n' >&2; exit 2 ;;
esac
case "$delay_seconds" in
  ''|*[!0-9]*) printf 'Invalid Package Manager probe delay.\\n' >&2; exit 2 ;;
esac
if [ "$attempt_limit" -le 0 ] || [ "$attempt_limit" -gt 30 ] || [ "$delay_seconds" -gt 10 ]; then
  printf 'Package Manager probe limits exceed the bounded range.\\n' >&2
  exit 2
fi

attempt=1
package_output=''
while [ "$attempt" -le "$attempt_limit" ]; do
  package_output="$(adb shell cmd package list packages 2>&1 | tr -d '\\r' || true)"
  if printf '%s\\n' "$package_output" | grep -q '^package:'; then
    printf 'Android Package Manager ready after %s probe(s).\\n' "$attempt"
    exit 0
  fi
  if [ "$attempt" -lt "$attempt_limit" ]; then
    sleep "$delay_seconds"
  fi
  attempt=$((attempt + 1))
done

printf 'Android Package Manager did not become ready after %s probe(s).\\n' "$attempt_limit"
printf 'Package Manager probe: %s\\n' "$package_output"
printf 'Package service: '
adb shell service check package || true
printf 'Boot complete: '
adb shell getprop sys.boot_completed || true
printf 'Package init state: '
adb shell getprop init.svc.package || true
exit 1
