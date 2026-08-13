package clientcore

import (
	"context"
	"encoding/json"
	"testing"
)

func TestInMemoryBridgeReturnsStoreSnapshots(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	engine := &Engine{ctx: ctx, cancel: cancel, stores: make(map[string]*store), events: make(chan Event, 1)}
	engine.bridge = newBridgeCore(engine, true)
	request := ConnectRequest{ServerType: "hub", ServerID: "agent-1"}
	engine.stores["hub:agent-1"] = newStore(engine, request)

	if err := engine.BridgeFrame(encodeFrame(FrameSyncRequest, 0, nil)); err != nil {
		t.Fatal(err)
	}
	raw, err := engine.NextBridgeFrame(0)
	if err != nil {
		t.Fatal(err)
	}
	frame, err := decodeFrame(raw)
	if err != nil {
		t.Fatal(err)
	}
	if frame.typ != FrameSyncResponse {
		t.Fatalf("frame type = %x, want %x", frame.typ, FrameSyncResponse)
	}
	var response struct {
		Stores []Snapshot `json:"stores"`
	}
	if err := json.Unmarshal(frame.payload, &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Stores) != 1 || response.Stores[0].StoreKey != "hub:agent-1" {
		t.Fatalf("unexpected stores: %+v", response.Stores)
	}
}

func TestInMemoryBridgeRejectsMalformedFrame(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	engine := &Engine{ctx: ctx, cancel: cancel, stores: make(map[string]*store), events: make(chan Event, 1)}
	engine.bridge = newBridgeCore(engine, true)
	if err := engine.BridgeFrame([]byte{FrameData}); err == nil {
		t.Fatal("expected malformed frame error")
	}
}
