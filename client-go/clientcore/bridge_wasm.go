//go:build js && wasm

package clientcore

func newBridgeServer(engine *Engine) (*bridgeServer, error) {
	return newBridgeCore(engine, true), nil
}
