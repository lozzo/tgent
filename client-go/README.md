# TGent Go client engine

This module contains only the connection engine used by TGent clients. It
supports local Socket/HTTP connections, remote WebSocket/WebRTC transports,
WebAssembly bindings, and the Android C ABI.

It does not implement a TGent endpoint, terminal provider, Hub, or hosted
service.

```bash
go test ./...
bash scripts/build-web-client.sh
```
