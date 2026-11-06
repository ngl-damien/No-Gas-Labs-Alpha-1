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

printf 'Package Manager probe smoke test passed: ready and fail-closed paths.\n'
