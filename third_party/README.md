Third-party notices
===================

TGent depends on Go modules, npm packages, Android libraries, and Wails.
Their package manifests and lock files identify exact versions and licenses.
Those components remain under their own licenses.

Files copied directly into this repository include:

- `tgent-app/public/wasm/wasm_exec.js`, from the Go distribution under the
  BSD 3-Clause license in `third_party/licenses/Go-BSD-3-Clause.txt`.
- `tgent-app/android/gradle/wrapper/gradle-wrapper.jar` and the Gradle wrapper
  scripts, under Apache License 2.0 in
  `third_party/licenses/Gradle-Apache-2.0.txt`.
- Terminal fonts under `shared/src/assets/fonts`, with license texts kept in
  `shared/src/assets/fonts/licenses`.
- Nunito under `tgent-desktop/frontend/src/assets/fonts`, with its OFL notice
  retained as `OFL.txt` in the same directory.

Release maintainers should include this directory, `NOTICE`, and bundled font
notices in binary distributions. Generated dependency inventories supplement,
but do not replace, notices required by individual licenses.
