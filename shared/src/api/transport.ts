import type { NativeTransportProxy } from './NativeTransportProxy'

// UI-facing transport is always a proxy to the shared Go engine. Web and
// native differ only in how bridge frames reach that engine.
export type WebRTCTransport = NativeTransportProxy
