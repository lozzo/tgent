//go:build !js || !wasm

package clientcore

import (
	"fmt"
	"net"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

func newBridgeServer(engine *Engine) (*bridgeServer, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen bridge: %w", err)
	}
	b := newBridgeCore(engine, false)
	b.platformPort = ln.Addr().(*net.TCPAddr).Port
	mux := http.NewServeMux()
	mux.HandleFunc("/", b.serveWebSocket)
	server := &http.Server{Handler: mux}
	b.platformStop = func() {
		_ = server.Close()
		_ = ln.Close()
	}
	go func() { _ = server.Serve(ln) }()
	return b, nil
}

func (b *bridgeServer) serveWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).Upgrade(w, r, nil)
	if err != nil {
		return
	}
	var writeMu sync.Mutex
	b.resetChannels()
	id := b.setDelivery(func(frame []byte) {
		writeMu.Lock()
		_ = conn.WriteMessage(websocket.BinaryMessage, frame)
		writeMu.Unlock()
	})
	defer func() {
		b.clearDelivery(id)
		_ = conn.Close()
	}()
	for {
		typ, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if typ == websocket.BinaryMessage {
			_ = b.handleBytes(data)
		}
	}
}
