#!/bin/sh
set -eu

probe="scripts/wait-for-android-package-manager.sh"
tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT
bin="$tmp_root/bin"
mkdir -p "$bin"
adb="$bin/adb"

cat > "$adb" <<'ADB_READY'
#!/bin/sh
case "$*" in
  "shell cmd package list packages") printf 'package:android\n' ;;
  *) printf 'unexpected adb command: %s\n' "$*" >&2; exit 64 ;;
esac
ADB_READY
chmod +x "$adb"
PATH="$bin:$PATH" NGL_ANDROID_PACKAGE_PROBE_ATTEMPTS=2 NGL_ANDROID_PACKAGE_PROBE_DELAY_SECONDS=0 sh "$probe" > "$tmp_root/ready.out"
grep -F 'Android Package Manager ready after 1 probe(s).' "$tmp_root/ready.out" >/dev/null

cat > "$adb" <<'ADB_UNAVAILABLE'
#!/bin/sh
case "$*" in
  "shell cmd package list packages") printf "Can't find service: package\n" >&2; exit 1 ;;
  "shell service check package") printf 'Service package: not found\n' ;;
  "shell getprop sys.boot_completed") printf '1\n' ;;
  "shell getprop init.svc.package") printf 'stopped\n' ;;
  *) printf 'unexpected adb command: %s\n' "$*" >&2; exit 64 ;;
esac
ADB_UNAVAILABLE
chmod +x "$adb"
if PATH="$bin:$PATH" NGL_ANDROID_PACKAGE_PROBE_ATTEMPTS=2 NGL_ANDROID_PACKAGE_PROBE_DELAY_SECONDS=0 sh "$probe" > "$tmp_root/unavailable.out" 2>&1; then
  printf 'Expected the unavailable Package Manager probe to fail closed.\n' >&2
  exit 1
else
  status=$?
fi
if [ "$status" -ne 1 ]; then
  printf 'Expected unavailable probe exit status 1, received %s.\n' "$status" >&2
  cat "$tmp_root/unavailable.out" >&2
  exit 1
fi
for expected in \
  'Android Package Manager did not become ready after 2 probe(s).' \
  "Can't find service: package" \
  'Service package: not found' \
  'Boot complete: 1' \
  'Package init state: stopped'; do
  if ! grep -F "$expected" "$tmp_root/unavailable.out" >/dev/null; then
    printf 'Missing expected diagnostic: %s\n' "$expected" >&2
    cat "$tmp_root/unavailable.out" >&2
    exit 1
  fi
done

retry="scripts/run-android-instrumentation-with-retry.sh"
order="$tmp_root/retry-order.log"
state="$tmp_root/gradle-attempts"

cat > "$adb" <<'ADB_RETRY_READY'
#!/bin/sh
case "$*" in
  "shell cmd package list packages") printf 'package:android\n'; printf 'adb\n' >> "$NGL_TEST_ANDROID_ORDER_FILE" ;;
  *) printf 'unexpected adb command: %s\n' "$*" >&2; exit 64 ;;
esac
ADB_RETRY_READY
chmod +x "$adb"

cat > "$bin/gradle" <<'GRADLE_TRANSIENT_ONCE'
#!/bin/sh
count=0
if [ -f "$NGL_TEST_GRADLE_STATE" ]; then count=$(cat "$NGL_TEST_GRADLE_STATE"); fi
count=$((count + 1))
printf '%s' "$count" > "$NGL_TEST_GRADLE_STATE"
printf 'gradle-%s\n' "$count" >> "$NGL_TEST_ANDROID_ORDER_FILE"
if [ "$count" -eq 1 ]; then
  printf 'Finished 0 tests on test(AVD) - 15\n'
  printf 'Message: Failed to install split APK(s): [app-debug.apk]\n'
  printf 'ErrorName: INSTALL_FAILED_VERIFICATION_FAILURE\n'
  printf 'Error: INSTALL_FAILED_VERIFICATION_FAILURE: Integrity verification timed out for file:///data/app/test.apk\n'
  exit 1
fi
printf 'BUILD SUCCESSFUL\n'
exit 0
GRADLE_TRANSIENT_ONCE
chmod +x "$bin/gradle"
PATH="$bin:$PATH" NGL_TEST_GRADLE_STATE="$state" NGL_TEST_ANDROID_ORDER_FILE="$order" \
  NGL_ANDROID_PACKAGE_PROBE_ATTEMPTS=2 NGL_ANDROID_PACKAGE_PROBE_DELAY_SECONDS=0 \
  sh "$retry" > "$tmp_root/retry.out" 2>&1
[ "$(cat "$state")" = "2" ]
grep -F 'retrying once after a bounded Package Manager readiness probe' "$tmp_root/retry.out" >/dev/null
grep -F 'Android Package Manager ready after 1 probe(s).' "$tmp_root/retry.out" >/dev/null
grep -F 'BUILD SUCCESSFUL' "$tmp_root/retry.out" >/dev/null
printf 'gradle-1\nadb\ngradle-2\n' > "$tmp_root/expected-order"
cmp -s "$order" "$tmp_root/expected-order"

cat > "$bin/gradle" <<'GRADLE_PACKAGE_SERVICE_RECOVERS'
#!/bin/sh
count=0
if [ -f "$NGL_TEST_GRADLE_STATE" ]; then count=$(cat "$NGL_TEST_GRADLE_STATE"); fi
count=$((count + 1))
printf '%s' "$count" > "$NGL_TEST_GRADLE_STATE"
printf 'gradle-%s\n' "$count" >> "$NGL_TEST_ANDROID_ORDER_FILE"
if [ "$count" -eq 1 ]; then
  printf 'Finished 0 tests on test(AVD) - 15\n'
  printf 'Message: Failed to install split APK(s): [app-debug.apk]\n'
  printf "'package install-create' returns error 'Unknown failure: cmd: Can't find service: package'\n"
  exit 1
fi
printf 'BUILD SUCCESSFUL\n'
exit 0
GRADLE_PACKAGE_SERVICE_RECOVERS
chmod +x "$bin/gradle"
: > "$state"
: > "$order"
PATH="$bin:$PATH" NGL_TEST_GRADLE_STATE="$state" NGL_TEST_ANDROID_ORDER_FILE="$order" \
  NGL_ANDROID_PACKAGE_PROBE_ATTEMPTS=2 NGL_ANDROID_PACKAGE_PROBE_DELAY_SECONDS=0 \
  sh "$retry" > "$tmp_root/package-service.out" 2>&1
[ "$(cat "$state")" = "2" ]
grep -F 'Package Manager service disappearance during split-APK installation' "$tmp_root/package-service.out" >/dev/null
grep -F 'Android Package Manager ready after 1 probe(s).' "$tmp_root/package-service.out" >/dev/null
grep -F 'BUILD SUCCESSFUL' "$tmp_root/package-service.out" >/dev/null
printf 'gradle-1\nadb\ngradle-2\n' > "$tmp_root/expected-order"
cmp -s "$order" "$tmp_root/expected-order"

cat > "$bin/gradle" <<'GRADLE_REAL_TEST_FAILURE'
#!/bin/sh
count=0
if [ -f "$NGL_TEST_GRADLE_STATE" ]; then count=$(cat "$NGL_TEST_GRADLE_STATE"); fi
count=$((count + 1))
printf '%s' "$count" > "$NGL_TEST_GRADLE_STATE"
printf 'There were failing instrumentation tests.\n'
exit 1
GRADLE_REAL_TEST_FAILURE
chmod +x "$bin/gradle"
: > "$state"
: > "$order"
if PATH="$bin:$PATH" NGL_TEST_GRADLE_STATE="$state" NGL_TEST_ANDROID_ORDER_FILE="$order" \
  sh "$retry" > "$tmp_root/real-failure.out" 2>&1; then
  printf 'Expected a real instrumentation test failure to remain failed.\n' >&2
  exit 1
else
  status=$?
fi
[ "$status" -eq 1 ]
[ "$(cat "$state")" = "1" ]
if grep -F 'retrying once' "$tmp_root/real-failure.out" >/dev/null; then
  printf 'A real test failure must not be retried.\n' >&2
  exit 1
fi

cat > "$bin/gradle" <<'GRADLE_ATTACH_FAILURE'
#!/bin/sh
count=0
if [ -f "$NGL_TEST_GRADLE_STATE" ]; then count=$(cat "$NGL_TEST_GRADLE_STATE"); fi
count=$((count + 1))
printf '%s' "$count" > "$NGL_TEST_GRADLE_STATE"
printf 'Finished 0 tests on test(AVD) - 15\n'
printf 'Test run failed to complete. Instrumentation run failed due to failed to attach\n'
exit 1
GRADLE_ATTACH_FAILURE
chmod +x "$bin/gradle"
: > "$state"
: > "$order"
if PATH="$bin:$PATH" NGL_TEST_GRADLE_STATE="$state" NGL_TEST_ANDROID_ORDER_FILE="$order" \
  sh "$retry" > "$tmp_root/attach-failure.out" 2>&1; then
  printf 'Expected a test-runner attach failure to remain failed.\n' >&2
  exit 1
else
  status=$?
fi
[ "$status" -eq 1 ]
[ "$(cat "$state")" = "1" ]
if grep -F 'retrying once' "$tmp_root/attach-failure.out" >/dev/null; then
  printf 'A test-runner attach failure must not be retried.\n' >&2
  exit 1
fi

cat > "$bin/gradle" <<'GRADLE_TRANSIENT_ALWAYS'
#!/bin/sh
count=0
if [ -f "$NGL_TEST_GRADLE_STATE" ]; then count=$(cat "$NGL_TEST_GRADLE_STATE"); fi
count=$((count + 1))
printf '%s' "$count" > "$NGL_TEST_GRADLE_STATE"
printf 'Finished 0 tests on test(AVD) - 15\n'
printf 'Message: Failed to install split APK(s): [app-debug.apk]\n'
printf 'ErrorName: INSTALL_FAILED_VERIFICATION_FAILURE\n'
printf 'Error: INSTALL_FAILED_VERIFICATION_FAILURE: Integrity verification timed out for file:///data/app/test.apk\n'
exit 1
GRADLE_TRANSIENT_ALWAYS
chmod +x "$bin/gradle"
: > "$state"
if PATH="$bin:$PATH" NGL_TEST_GRADLE_STATE="$state" NGL_TEST_ANDROID_ORDER_FILE="$order" \
  NGL_ANDROID_PACKAGE_PROBE_ATTEMPTS=2 NGL_ANDROID_PACKAGE_PROBE_DELAY_SECONDS=0 \
  sh "$retry" > "$tmp_root/persistent-timeout.out" 2>&1; then
  printf 'Expected the second transient install timeout to remain failed.\n' >&2
  exit 1
else
  status=$?
fi
[ "$status" -eq 1 ]
[ "$(cat "$state")" = "2" ]
grep -F 'no further retry will be attempted' "$tmp_root/persistent-timeout.out" >/dev/null

printf 'Android Package Manager and instrumentation retry smoke tests passed.\n'
