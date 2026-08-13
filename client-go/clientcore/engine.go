package clientcore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
)

type Event struct {
	Type     string          `json:"type"`
	StoreKey string          `json:"storeKey,omitempty"`
	Snapshot json.RawMessage `json:"snapshot,omitempty"`
	Token    string          `json:"token,omitempty"`
	Refresh  string          `json:"refreshToken,omitempty"`
	Message  string          `json:"message,omitempty"`
}

type ConnectRequest struct {
	ServerType  string          `json:"serverType"`
	ServerID    string          `json:"serverId"`
	LocalServer json.RawMessage `json:"localServer,omitempty"`
	WebURL      string          `json:"webUrl,omitempty"`
	WebToken    string          `json:"webToken,omitempty"`
	Refresh     string          `json:"refreshToken,omitempty"`
}

type command struct {
	Action string `json:"action"`
	ConnectRequest
	StoreKey    string          `json:"storeKey,omitempty"`
	Keys        []string        `json:"keys,omitempty"`
	NetworkUp   *bool           `json:"networkUp,omitempty"`
	AppActive   *bool           `json:"appActive,omitempty"`
	Resume      bool            `json:"resume,omitempty"`
	NetworkType string          `json:"networkType,omitempty"`
	Payload     json.RawMessage `json:"payload,omitempty"`
}

type Engine struct {
	ctx    context.Context
	cancel context.CancelFunc

	mu          sync.RWMutex
	stores      map[string]*store
	events      chan Event
	bridge      *bridgeServer
	closed      bool
	networkUp   bool
	appActive   bool
	networkType string
}

func NewEngine() (*Engine, error) {
	ctx, cancel := context.WithCancel(context.Background())
	e := &Engine{ctx: ctx, cancel: cancel, stores: make(map[string]*store), events: make(chan Event, 256), networkUp: true, appActive: true}
	b, err := newBridgeServer(e)
	if err != nil {
		cancel()
		return nil, err
	}
	e.bridge = b
	return e, nil
}

func (e *Engine) BridgePort() int { return e.bridge.port() }

// BridgeFrame routes one UI bridge frame into the shared Go engine. Browser
// WASM uses this directly; native platforms use the same method via WebSocket.
func (e *Engine) BridgeFrame(frame []byte) error { return e.bridge.handleBytes(frame) }

// NextBridgeFrame returns the next Go-to-UI bridge frame.
func (e *Engine) NextBridgeFrame(timeout time.Duration) ([]byte, error) {
	return e.bridge.nextFrame(timeout)
}

func (e *Engine) Command(payload []byte) ([]byte, error) {
	var cmd command
	if err := json.Unmarshal(payload, &cmd); err != nil {
		return nil, fmt.Errorf("decode command: %w", err)
	}
	switch cmd.Action {
	case "connect":
		if cmd.ServerType == "" || cmd.ServerID == "" {
			return nil, errors.New("serverType and serverId are required")
		}
		e.connect(cmd.ConnectRequest)
		return []byte(`{"ok":true}`), nil
	case "retry":
		key := storeKey(cmd.ServerType, cmd.ServerID)
		e.mu.RLock()
		s := e.stores[key]
		e.mu.RUnlock()
		if s != nil {
			s.retry()
		}
		return []byte(`{"ok":true}`), nil
	case "release":
		e.release(storeKey(cmd.ServerType, cmd.ServerID))
		return []byte(`{"ok":true}`), nil
	case "release_all":
		e.releaseMatching(func(string) bool { return true })
		return []byte(`{"ok":true}`), nil
	case "release_hub":
		e.releaseMatching(func(key string) bool { return len(key) >= 4 && key[:4] == "hub:" })
		return []byte(`{"ok":true}`), nil
	case "release_keys":
		for _, key := range cmd.Keys {
			e.release(key)
		}
		return []byte(`{"ok":true}`), nil
	case "snapshot":
		key := storeKey(cmd.ServerType, cmd.ServerID)
		e.mu.RLock()
		s := e.stores[key]
		e.mu.RUnlock()
		if s == nil {
			return []byte(`{}`), nil
		}
		return json.Marshal(s.snapshot())
	case "connection_info":
		e.mu.RLock()
		s := e.stores[cmd.StoreKey]
		e.mu.RUnlock()
		if s == nil {
			return []byte(`{"type":"unknown"}`), nil
		}
		return json.Marshal(s.connectionInfo())
	case "network":
		if cmd.NetworkUp != nil {
			e.handleNetwork(*cmd.NetworkUp, cmd.NetworkType)
		}
		return []byte(`{"ok":true}`), nil
	case "lifecycle":
		if cmd.AppActive != nil {
			e.handleLifecycle(*cmd.AppActive, cmd.Resume)
		}
		return []byte(`{"ok":true}`), nil
	default:
		return nil, fmt.Errorf("unknown command %q", cmd.Action)
	}
}

func (e *Engine) storesSnapshot() []*store {
	e.mu.RLock()
	defer e.mu.RUnlock()
	stores := make([]*store, 0, len(e.stores))
	for _, s := range e.stores {
		stores = append(stores, s)
	}
	return stores
}

func (e *Engine) handleNetwork(up bool, networkType string) {
	e.mu.Lock()
	previousUp := e.networkUp
	typeChanged := networkType != "" && e.networkType != "" && networkType != e.networkType
	e.networkUp = up
	if networkType != "" {
		e.networkType = networkType
	}
	stores := make([]*store, 0, len(e.stores))
	for _, s := range e.stores {
		stores = append(stores, s)
	}
	e.mu.Unlock()
	for _, s := range stores {
		s.onNetworkChange(up, previousUp, typeChanged)
	}
}

func (e *Engine) handleLifecycle(active, resume bool) {
	e.mu.Lock()
	e.appActive = active
	stores := make([]*store, 0, len(e.stores))
	for _, s := range e.stores {
		stores = append(stores, s)
	}
	e.mu.Unlock()
	for _, s := range stores {
		s.onLifecycleChange(active, resume)
	}
}

func (e *Engine) connect(req ConnectRequest) {
	key := storeKey(req.ServerType, req.ServerID)
	e.mu.Lock()
	s := e.stores[key]
	if s == nil {
		s = newStore(e, req)
		s.networkUp = e.networkUp
		s.appActive = e.appActive
		e.stores[key] = s
	} else {
		s.updateRequest(req)
	}
	e.mu.Unlock()
	s.connect()
}

func (e *Engine) release(key string) {
	e.mu.Lock()
	s := e.stores[key]
	delete(e.stores, key)
	e.mu.Unlock()
	if s != nil {
		s.close()
	}
}

func (e *Engine) releaseMatching(match func(string) bool) {
	e.mu.RLock()
	keys := make([]string, 0)
	for key := range e.stores {
		if match(key) {
			keys = append(keys, key)
		}
	}
	e.mu.RUnlock()
	for _, key := range keys {
		e.release(key)
	}
}

func (e *Engine) NextEvent(timeout time.Duration) ([]byte, error) {
	if timeout <= 0 {
		select {
		case event := <-e.events:
			return json.Marshal(event)
		default:
			return []byte{}, nil
		}
	}
	select {
	case event := <-e.events:
		return json.Marshal(event)
	case <-time.After(timeout):
		return []byte{}, nil
	case <-e.ctx.Done():
		return nil, errors.New("engine closed")
	}
}

func (e *Engine) emit(event Event) {
	select {
	case e.events <- event:
	default:
	}
}

func (e *Engine) Close() {
	e.mu.Lock()
	if e.closed {
		e.mu.Unlock()
		return
	}
	e.closed = true
	stores := e.stores
	e.stores = make(map[string]*store)
	e.mu.Unlock()
	e.cancel()
	for _, s := range stores {
		s.close()
	}
	e.bridge.close()
}

func storeKey(serverType, serverID string) string { return serverType + ":" + serverID }
