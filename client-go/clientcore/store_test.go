package clientcore

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestHubOnlyLocalCardWithoutTokenFailsInsteadOfPanicking(t *testing.T) {
	local, err := json.Marshal(localServer{HubAgentID: "agent-1"})
	if err != nil {
		t.Fatal(err)
	}
	engine := &Engine{ctx: context.Background(), events: make(chan Event, 4)}
	s := newStore(engine, ConnectRequest{ServerType: "local", ServerID: "card-1", LocalServer: local})
	s.runConnectLoop(context.Background(), false)
	snapshot := s.snapshot()
	if snapshot.Phase != "failed" || !snapshot.NeedLogin {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
}

func TestNetworkLossMovesActiveStoreToWaitingNetwork(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	engine := &Engine{
		ctx: ctx, cancel: cancel, events: make(chan Event, 8), stores: make(map[string]*store),
		networkUp: true, appActive: true,
	}
	s := newStore(engine, ConnectRequest{ServerType: "local", ServerID: "test"})
	s.phase = "connecting"
	engine.stores[s.key] = s

	engine.handleNetwork(false, "none")
	snapshot := s.snapshot()
	if snapshot.Phase != "waiting_network" || snapshot.StatusText != "等待网络恢复..." {
		t.Fatalf("unexpected offline snapshot: %#v", snapshot)
	}
	if s.networkUp {
		t.Fatal("store still considers network available")
	}
}

func TestConnectWhileOfflineWaitsForNetwork(t *testing.T) {
	engine := &Engine{ctx: context.Background(), events: make(chan Event, 2)}
	s := newStore(engine, ConnectRequest{ServerType: "local", ServerID: "test"})
	s.networkUp = false
	s.connect()
	if snapshot := s.snapshot(); snapshot.Phase != "waiting_network" {
		t.Fatalf("unexpected offline connect snapshot: %#v", snapshot)
	}
}

func TestHealthProbeTimeoutIsClamped(t *testing.T) {
	tests := []struct {
		rtt, want time.Duration
	}{
		{10 * time.Millisecond, 500 * time.Millisecond},
		{300 * time.Millisecond, 900 * time.Millisecond},
		{2 * time.Second, 3 * time.Second},
	}
	for _, test := range tests {
		if got := healthProbeTimeout(test.rtt); got != test.want {
			t.Fatalf("healthProbeTimeout(%s) = %s, want %s", test.rtt, got, test.want)
		}
	}
}
