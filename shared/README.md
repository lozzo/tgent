# TGent shared client

This directory owns the frontend code shared by the mobile app, Wails desktop
client, and browser clients. Platform packages own only their native shell,
entry configuration, and release artifacts.

- `src/api`, `src/state`, and `src/lib` contain reusable protocol and state code.
- `src/components` contains reusable terminal and file-management UI.
- App and Desktop are statically selected with `app` and `desktop` Vite modes.
- Web code should import framework-neutral modules through `@tgent/shared/*`.

Build targets:

```sh
npm run build:app
npm run build:desktop
```
