package clientcore

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"runtime/debug"
	"sync"
	"time"
)

type Snapshot struct {
	StoreKey           string `json:"storeKey"`
	Phase              string `json:"phase"`
	StatusText         string `json:"statusText"`
	ConnectionMode     string `json:"connectionMode,omitempty"`
	ReconnectAttempt   int    `json:"reconnectAttempt"`
	IsRecovering       bool   `json:"isRecovering"`
	NeedLogin          bool   `json:"needLogin"`
	AllowRelayTransfer bool   `json:"allowRelayTransfer"`
	Version            int64  `json:"version"`
}

type store struct {
	engine     *Engine
	key        string
	mu         sync.RWMutex
	req        ConnectRequest
	phase      string
	status     string
	mode       string
	attempt    int
	needLogin  bool
	allowRelay bool
	version    int64
	transport  *transport
	cancel     context.CancelFunc
	released   bool
	networkUp  bool
	appActive  bool
	recoverSeq uint64
}

func newStore(engine *Engine, req ConnectRequest) *store {
	return &store{engine: engine, key: storeKey(req.ServerType, req.ServerID), req: req, phase: "idle", status: "准备连接...", networkUp: true, appActive: true}
}

func (s *store) updateRequest(req ConnectRequest) { s.mu.Lock(); s.req = req; s.mu.Unlock() }

func (s *store) connect() {
	s.mu.Lock()
	if s.released || s.phase == "connecting" || s.phase == "probing" || s.phase == "connected" {
		s.mu.Unlock()
		return
	}
	if !s.networkUp {
		s.mu.Unlock()
		s.setPhase("waiting_network", "等待网络恢复...")
		return
	}
	ctx, cancel := context.WithCancel(s.engine.ctx)
	if s.cancel != nil {
		s.cancel()
	}
	s.cancel = cancel
	s.mu.Unlock()
	go s.runConnectLoop(ctx, false)
}

func (s *store) retry() {
	s.mu.Lock()
	if s.cancel != nil {
		s.cancel()
	}
	old := s.transport
	s.transport = nil
	s.attempt = 0
	s.needLogin = false
	s.mode = ""
	s.allowRelay = false
	s.recoverSeq++
	s.mu.Unlock()
	if old != nil {
		old.close()
	}
	s.setPhase("idle", "准备连接...")
	s.connect()
}

func (s *store) connectLoop(ctx context.Context, reconnect bool) {
	s.mu.RLock()
	req := s.req
	attempt := s.attempt
	s.mu.RUnlock()
	if reconnect {
		delays := []time.Duration{500 * time.Millisecond, 2 * time.Second, 4 * time.Second, 8 * time.Second, 15 * time.Second}
		delay := delays[min(attempt, len(delays)-1)]
		s.setPhase("reconnecting", fmt.Sprintf("正在重连（第 %d 次）...", attempt+1))
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return
		}
	}

	var tr *transport
	var mode string
	var err error
	if req.ServerType == "hub" {
		if req.WebToken == "" {
			s.fail("需要登录", true)
			return
		}
		s.setPhase("connecting", "正在获取连接信息...")
		tr, err = connectHub(ctx, s, req.ServerID, req, s.progress)
		mode = "p2p"
	} else {
		var local localServer
		if len(req.LocalServer) > 0 {
			_ = json.Unmarshal(req.LocalServer, &local)
		}
		hasLocal := local.SocketPath != "" || local.Addr != "" || len(local.LocalAddrs) > 0
		hasHub := local.HubAgentID != ""
		raced := false
		if !hasLocal && !hasHub {
			s.fail("无可用连接地址", false)
			return
		}
		if hasLocal && hasHub && req.WebToken != "" {
			raced = true
			s.setPhase("connecting", "正在同时尝试本地与 P2P 连接...")
			tr, mode, err = raceConnections(ctx, s, local, req)
		} else if hasLocal {
			s.setPhase("probing", "正在探测地址...")
			tr, err = connectLocal(ctx, s, local, s.progress)
			mode = "local"
		}
		if !raced && (!hasLocal || err != nil) && hasHub && tr == nil {
			if req.WebToken == "" {
				s.fail("需要登录", true)
				return
			}
			s.setPhase("connecting", "正在准备 P2P 连接...")
			tr, err = connectHub(ctx, s, local.HubAgentID, req, s.progress)
			mode = "p2p"
		}
	}
	if ctx.Err() != nil {
		if tr != nil {
			tr.close()
		}
		return
	}
	if err != nil {
		s.scheduleReconnect(ctx, err)
		return
	}
	if tr == nil {
		s.fail("无可用连接信息", false)
		return
	}

	s.mu.Lock()
	if s.released {
		s.mu.Unlock()
		tr.close()
		return
	}
	old := s.transport
	s.transport = tr
	s.mode = mode
	s.allowRelay = tr.allowRelay
	s.attempt = 0
	s.needLogin = false
	s.mu.Unlock()
	if old != nil {
		old.close()
	}
	tr.onClosed = func() { s.onDisconnected(tr) }
	s.setPhase("connected", "已连接")
	tr.startHealthMonitor()
}

func (s *store) scheduleReconnect(parent context.Context, err error) {
	s.mu.Lock()
	if s.released {
		s.mu.Unlock()
		return
	}
	if !s.networkUp {
		s.mu.Unlock()
		s.setPhase("waiting_network", "等待网络恢复...")
		return
	}
	s.attempt++
	attempt := s.attempt
	s.mu.Unlock()
	if attempt >= 20 {
		s.fail("重连失败，已达最大重试次数", false)
		return
	}
	if isAuthError(err) {
		s.fail(err.Error(), true)
		return
	}
	if parent.Err() != nil {
		return
	}
	s.mu.Lock()
	ctx, cancel := context.WithCancel(s.engine.ctx)
	s.cancel = cancel
	s.mu.Unlock()
	go s.runConnectLoop(ctx, true)
}

// A connector bug must fail one store, never terminate the Android process.
func (s *store) runConnectLoop(ctx context.Context, reconnect bool) {
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("mobile client connection panic for %s: %v\n%s", s.key, recovered, debug.Stack())
			s.fail("连接异常，请重试", false)
		}
	}()
	s.connectLoop(ctx, reconnect)
}

func (s *store) onDisconnected(tr *transport) {
	s.mu.Lock()
	if s.released || s.transport != tr {
		s.mu.Unlock()
		return
	}
	s.transport = nil
	s.recoverSeq++
	networkUp := s.networkUp
	s.mu.Unlock()
	tr.close()
	if !networkUp {
		s.setPhase("waiting_network", "等待网络恢复...")
		return
	}
	s.scheduleReconnect(s.engine.ctx, fmt.Errorf("connection closed"))
}

func (s *store) onNetworkChange(up, previousUp, typeChanged bool) {
	if !up {
		s.mu.Lock()
		if s.released || !s.networkUp {
			s.mu.Unlock()
			return
		}
		s.networkUp = false
		s.recoverSeq++
		if s.cancel != nil {
			s.cancel()
		}
		tr := s.transport
		s.transport = nil
		s.mu.Unlock()
		if tr != nil {
			tr.close()
		}
		s.setPhase("waiting_network", "等待网络恢复...")
		return
	}

	s.mu.Lock()
	wasDown := !s.networkUp || !previousUp
	s.networkUp = true
	phase := s.phase
	s.mu.Unlock()
	if wasDown || phase == "waiting_network" {
		s.retry()
		return
	}
	if typeChanged && phase == "connected" {
		s.verifyCurrentTransport(200 * time.Millisecond)
	}
}

func (s *store) onLifecycleChange(active, resume bool) {
	s.mu.Lock()
	s.appActive = active
	s.mu.Unlock()
	if active && resume {
		s.resume()
	}
}

func (s *store) resume() {
	s.mu.RLock()
	if s.released || !s.networkUp {
		s.mu.RUnlock()
		return
	}
	phase := s.phase
	tr := s.transport
	s.mu.RUnlock()
	if phase == "connected" && tr != nil {
		s.verifyCurrentTransport(0)
		return
	}
	if phase == "connected" || phase == "waiting_network" || phase == "reconnecting" || phase == "failed" {
		s.retry()
	}
}

func (s *store) verifyCurrentTransport(delay time.Duration) {
	s.mu.Lock()
	tr := s.transport
	if s.released || tr == nil || !s.networkUp {
		s.mu.Unlock()
		return
	}
	s.recoverSeq++
	seq := s.recoverSeq
	s.mu.Unlock()
	s.setPhase("verifying", "正在验证连接...")
	go func() {
		if delay > 0 {
			select {
			case <-time.After(delay):
			case <-s.engine.ctx.Done():
				return
			}
		}
		if !tr.isPeerConnected() {
			deadline := time.Now().Add(5 * time.Second)
			for time.Now().Before(deadline) && tr.hasPeerConnection() && !tr.isPeerConnected() {
				time.Sleep(200 * time.Millisecond)
			}
		}
		err := tr.probeStatus(healthProbeTimeout(tr.lastRTT()))
		s.mu.RLock()
		current := !s.released && s.transport == tr && s.recoverSeq == seq
		s.mu.RUnlock()
		if !current {
			return
		}
		if err == nil {
			s.setPhase("connected", "已连接")
			return
		}
		s.retry()
	}()
}

func (s *store) fail(message string, needLogin bool) {
	s.mu.Lock()
	s.needLogin = needLogin
	s.mu.Unlock()
	s.setPhase("failed", message)
}

func (s *store) setPhase(phase, status string) {
	s.mu.Lock()
	s.phase = phase
	s.status = status
	s.version++
	snap := s.snapshotLocked()
	s.mu.Unlock()
	raw, _ := json.Marshal(snap)
	s.engine.emit(Event{Type: "state_change", StoreKey: s.key, Snapshot: raw})
}

func (s *store) progress(status string) {
	s.mu.Lock()
	if s.released || s.phase == "connected" || s.phase == "failed" || s.phase == "waiting_network" || s.phase == "verifying" {
		s.mu.Unlock()
		return
	}
	s.phase = "connecting"
	s.status = status
	s.version++
	snap := s.snapshotLocked()
	s.mu.Unlock()
	raw, _ := json.Marshal(snap)
	s.engine.emit(Event{Type: "state_change", StoreKey: s.key, Snapshot: raw})
}

func (s *store) snapshot() Snapshot { s.mu.RLock(); defer s.mu.RUnlock(); return s.snapshotLocked() }

func (s *store) snapshotLocked() Snapshot {
	return Snapshot{StoreKey: s.key, Phase: s.phase, StatusText: s.status, ConnectionMode: s.mode, ReconnectAttempt: s.attempt, IsRecovering: s.phase == "reconnecting" || s.phase == "verifying", NeedLogin: s.needLogin, AllowRelayTransfer: s.allowRelay, Version: s.version}
}

func (s *store) close() {
	s.mu.Lock()
	if s.released {
		s.mu.Unlock()
		return
	}
	s.released = true
	if s.cancel != nil {
		s.cancel()
	}
	tr := s.transport
	s.transport = nil
	s.mu.Unlock()
	if tr != nil {
		tr.close()
	}
}

func (s *store) openChannel(dcLabel, bridgeLabel string) error {
	s.mu.RLock()
	tr := s.transport
	s.mu.RUnlock()
	if tr == nil {
		return fmt.Errorf("connection not ready")
	}
	return tr.openChannel(dcLabel, bridgeLabel)
}
func (s *store) closeChannel(label string) {
	s.mu.RLock()
	tr := s.transport
	s.mu.RUnlock()
	if tr != nil {
		tr.closeChannel(label)
	}
}
func (s *store) send(label string, payload []byte) error {
	s.mu.RLock()
	tr := s.transport
	s.mu.RUnlock()
	if tr == nil {
		return fmt.Errorf("connection not ready")
	}
	return tr.send(label, payload)
}
func (s *store) connectionInfo() map[string]any {
	s.mu.RLock()
	tr := s.transport
	s.mu.RUnlock()
	if tr == nil {
		return map[string]any{"type": "unknown"}
	}
	return tr.connectionInfo()
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
