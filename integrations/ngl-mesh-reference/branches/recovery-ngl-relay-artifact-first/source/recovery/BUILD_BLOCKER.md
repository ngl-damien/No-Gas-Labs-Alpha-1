# Build environment observation

Observed during recovery:

* `java -version`: OpenJDK 21.0.11
* `gradle`: not installed / not on PATH
* `ANDROID_HOME`: unset
* no Android SDK `platforms` directory found in `/opt` or `/usr/local`
* attempt to install `androguard` via pip failed because external DNS/network resolution is unavailable

This blocks Android packaging in this execution environment. It does not block DEX/manifest/signature analysis; those were performed directly from bytes with local parsers and JDK tooling.
