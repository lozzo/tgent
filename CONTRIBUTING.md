# Contributing

Contributions to the TGent client applications are welcome. This repository is
client-only; changes that implement or embed endpoint, daemon, Hub,
control-plane, billing, or deployment services are out of scope.

## Development setup

```bash
git clone https://github.com/lozzo/tgent-client.git
cd tgent-client
make bootstrap
make test
```

Keep changes focused and include tests for behavior that affects terminal I/O,
connection lifecycle, resize ownership, clipboard handling, or native window
behavior. Run `make check` before opening a pull request.

Generated WebAssembly, Android native libraries, packaged apps, APKs, build
directories, local configuration, signing material, and credentials must not be
committed.

By contributing, you agree that your contribution is licensed under the
repository's `AGPL-3.0-only` license.
