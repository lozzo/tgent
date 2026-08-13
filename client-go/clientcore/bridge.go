package clientcore

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

// bridgeServer owns the platform-neutral UI/DataChannel frame router. Native
// platforms attach a localhost WebSocket writer; WebAssembly reads frames from
// the in-memory queue exposed by Engine.NextBridgeFrame.
type bridgeServer struct {
	engine       *Engine
	mu           sync.Mutex
	labels       map[uint16]string
	nextGeneral  uint16
	nextTerminal uint16
	nextFile     uint16
	deliver      func([]byte)
	deliveryID   uint64
	queueOutput  bool
	outbound     chan []byte
	platformPort int
	platformStop func()
}

func newBridgeCore(engine *Engine, queueOutput bool) *bridgeServer {
	return &bridgeServer{
		engine: engine, labels: make(map[uint16]string), nextGeneral: 0x10,
		nextTerminal: 0x100, nextFile: 0x200, queueOutput: queueOutput,
		outbound: make(chan []byte, 512),
	}
}

func (b *bridgeServer) port() int { return b.platformPort }

func (b *bridgeServer) resetChannels() {
	b.mu.Lock()
	b.labels = make(map[uint16]string)
	b.nextGeneral = 0x10
	b.nextTerminal = 0x100
	b.nextFile = 0x200
	b.mu.Unlock()
}

func (b *bridgeServer) setDelivery(deliver func([]byte)) uint64 {
	b.mu.Lock()
	b.deliveryID++
	id := b.deliveryID
	b.deliver = deliver
	b.mu.Unlock()
	return id
}

func (b *bridgeServer) clearDelivery(id uint64) {
	b.mu.Lock()
	if b.deliveryID == id {
		b.deliver = nil
	}
	b.mu.Unlock()
}

func (b *bridgeServer) handleBytes(data []byte) error {
	frame, err := decodeFrame(data)
	if err != nil {
		return err
	}
	b.handle(frame)
	return nil
}

func (b *bridgeServer) handle(frame bridgeFrame) {
	switch frame.typ {
	case FrameOpenChannel:
		label := string(frame.payload)
		id := b.allocateChannel(label)
		if id == 0 {
			b.send(FrameChannelError, frame.channelID, []byte("unknown channel label"))
			return
		}
		b.mu.Lock()
		b.labels[id] = label
		b.mu.Unlock()
		if strings.HasPrefix(label, "api:") || strings.HasPrefix(label, "events:") || label == "api" || label == "events" {
			b.send(FrameChannelOpened, id, []byte(label))
			return
		}
		// Opening a browser DataChannel is asynchronous. Never block the
		// syscall/js callback, or its onopen event cannot run.
		go func() {
			if err := b.engine.openDataChannel(label); err != nil {
				b.send(FrameChannelError, id, []byte(err.Error()))
				return
			}
			b.send(FrameChannelOpened, id, []byte(label))
		}()
	case FrameData:
		b.mu.Lock()
		label := b.labels[frame.channelID]
		b.mu.Unlock()
		if label != "" {
			_ = b.engine.sendData(label, frame.payload)
		}
	case FrameCloseChannel:
		b.mu.Lock()
		label := b.labels[frame.channelID]
		delete(b.labels, frame.channelID)
		b.mu.Unlock()
		if label != "" {
			b.engine.closeDataChannel(label)
		}
	case FrameSyncRequest:
		b.engine.mu.RLock()
		stores := make([]Snapshot, 0, len(b.engine.stores))
		for _, s := range b.engine.stores {
			stores = append(stores, s.snapshot())
		}
		b.engine.mu.RUnlock()
		payload, _ := json.Marshal(map[string]any{"stores": stores})
		b.send(FrameSyncResponse, 0, payload)
	case FrameTransferRequest:
		b.engine.emit(Event{Type: "transfer_request", Message: string(frame.payload)})
	}
}

func (b *bridgeServer) allocateChannel(label string) uint16 {
	b.mu.Lock()
	defer b.mu.Unlock()
	for id, existing := range b.labels {
		if existing == label {
			return id
		}
	}
	switch {
	case label == "api":
		return 1
	case label == "events":
		return 2
	case strings.HasPrefix(label, "api:"), strings.HasPrefix(label, "events:"):
		id := b.nextGeneral
		b.nextGeneral++
		return id
	case strings.HasPrefix(label, "terminal:"):
		id := b.nextTerminal
		b.nextTerminal++
		return id
	case strings.HasPrefix(label, "file:"):
		id := b.nextFile
		b.nextFile++
		return id
	default:
		return 0
	}
}

func (b *bridgeServer) forward(label string, payload []byte) {
	b.mu.Lock()
	var id uint16
	for candidate, existing := range b.labels {
		if existing == label {
			id = candidate
			break
		}
	}
	b.mu.Unlock()
	if id != 0 {
		b.send(FrameData, id, payload)
	}
}

func (b *bridgeServer) send(typ byte, channelID uint16, payload []byte) {
	frame := encodeFrame(typ, channelID, payload)
	b.mu.Lock()
	deliver := b.deliver
	queueOutput := b.queueOutput
	b.mu.Unlock()
	if deliver != nil {
		deliver(frame)
		return
	}
	if queueOutput {
		select {
		case b.outbound <- frame:
		default:
		}
	}
}

func (b *bridgeServer) nextFrame(timeout time.Duration) ([]byte, error) {
	if timeout <= 0 {
		select {
		case frame := <-b.outbound:
			return frame, nil
		default:
			return nil, nil
		}
	}
	select {
	case frame := <-b.outbound:
		return frame, nil
	case <-time.After(timeout):
		return nil, nil
	case <-b.engine.ctx.Done():
		return nil, fmt.Errorf("engine closed")
	}
}

func (b *bridgeServer) close() {
	if b.platformStop != nil {
		b.platformStop()
	}
}

func parseLabel(label string) (storeKey, channelLabel string) {
	parts := strings.SplitN(label, ":", 4)
	if len(parts) < 3 {
		return "", label
	}
	storeKey = parts[1] + ":" + parts[2]
	switch parts[0] {
	case "api", "events":
		channelLabel = parts[0]
	case "terminal", "file":
		if len(parts) == 4 {
			channelLabel = parts[0] + ":" + parts[3]
		}
	}
	return
}

func (e *Engine) openDataChannel(label string) error {
	key, dcLabel := parseLabel(label)
	e.mu.RLock()
	s := e.stores[key]
	e.mu.RUnlock()
	if s == nil {
		return fmt.Errorf("no connection for %s", key)
	}
	return s.openChannel(dcLabel, label)
}

func (e *Engine) sendData(label string, payload []byte) error {
	key, dcLabel := parseLabel(label)
	e.mu.RLock()
	s := e.stores[key]
	e.mu.RUnlock()
	if s == nil {
		return fmt.Errorf("no connection for %s", key)
	}
	return s.send(dcLabel, payload)
}

func (e *Engine) closeDataChannel(label string) {
	key, dcLabel := parseLabel(label)
	e.mu.RLock()
	s := e.stores[key]
	e.mu.RUnlock()
	if s != nil {
		s.closeChannel(dcLabel)
	}
}
