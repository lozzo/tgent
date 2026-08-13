package clientcore

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/webrtc/v4"
	"golang.org/x/crypto/pbkdf2"
)

type localServer struct {
	Addr           string   `json:"addr"`
	LocalAddrs     []string `json:"localAddrs"`
	SocketPath     string   `json:"socketPath"`
	Password       string   `json:"password"`
	HubAgentID     string   `json:"hubAgentId"`
	PairCode       string   `json:"pairCode"`
	PrivateKeySeed string   `json:"privateKeySeed"`
}
type iceConfig struct {
	IceServers []struct {
		URLs       []string `json:"urls"`
		Username   string   `json:"username"`
		Credential string   `json:"credential"`
	} `json:"iceServers"`
}
type answer struct {
	SDP string `json:"sdp"`
}

type transport struct {
	store         *store
	pc            *webrtc.PeerConnection
	mu            sync.RWMutex
	channels      map[string]*webrtc.DataChannel
	bridgeLabels  map[string]string
	closeOnce     sync.Once
	notifyOnce    sync.Once
	onClosed      func()
	connectedAt   time.Time
	healthMu      sync.Mutex
	healthCancel  context.CancelFunc
	graceCancel   context.CancelFunc
	healthPending map[string]*healthPending
	healthSeq     atomic.Uint64
	lastRTTMs     atomic.Int64
	allowRelay    bool
	infoMu        sync.RWMutex
	info          map[string]any
	infoLoading   bool
}

type healthPending struct {
	done   chan error
	chunks [][]byte
}

type connectionProgress func(string)

type connectionResult struct {
	transport *transport
	mode      string
	err       error
}

const (
	healthInterval = 5 * time.Second
	healthMaxFails = 4
	apiChunkMagic  = byte(0xC0)
	apiChunkFirst  = byte(0x01)
	apiChunkLast   = byte(0x02)
)

func connectLocal(ctx context.Context, s *store, local localServer, progress connectionProgress) (*transport, error) {
	progress = whileActive(ctx, progress)
	if local.SocketPath != "" {
		progress("正在通过本地 Socket 连接...")
		transport, err := connectLocalSocket(ctx, s, local.SocketPath, progress)
		if err == nil {
			return transport, nil
		}
		if len(uniqueAddresses(local)) == 0 {
			return nil, err
		}
		progress("本地 Socket 不可用，正在回退到 HTTP...")
	}

	addresses := uniqueAddresses(local)
	progress(fmt.Sprintf("正在并行探测 %d 个本地地址...", len(addresses)))
	base := probeLocalAddresses(ctx, addresses)
	if base == "" {
		return nil, fmt.Errorf("local address unreachable")
	}
	var token string
	if local.Password != "" {
		progress("本地地址已响应，正在验证凭据...")
		body, _ := json.Marshal(map[string]string{"password": local.Password})
		var out struct {
			Token string `json:"token"`
		}
		if err := doJSON(ctx, "POST", base+"/api/v1/auth/login", "", body, &out, 8*time.Second, nil); err != nil {
			return nil, err
		}
		token = out.Token
	}
	return establish(ctx, s, nil, "本地", progress, func(offer string) (answer, error) {
		var out answer
		body, _ := json.Marshal(map[string]any{"sdp": offer, "candidates": []string{}})
		err := doJSON(ctx, "POST", base+"/api/v1/rtc/offer", bearer(token), body, &out, 12*time.Second, nil)
		return out, err
	})
}

func connectLocalSocket(ctx context.Context, s *store, socketPath string, progress connectionProgress) (*transport, error) {
	client, httpTransport := localSocketHTTPClient(socketPath, 12*time.Second)
	defer httpTransport.CloseIdleConnections()

	var status struct {
		Status string `json:"status"`
	}
	if err := doJSONWithClient(ctx, client, "GET", "http://tgent.local/api/v1/status", "", nil, &status, nil); err != nil {
		return nil, fmt.Errorf("probe local socket: %w", err)
	}
	if status.Status != "ok" {
		return nil, fmt.Errorf("unexpected local socket status")
	}

	return establish(ctx, s, nil, "本地 Socket", progress, func(offer string) (answer, error) {
		var out answer
		body, _ := json.Marshal(map[string]any{"sdp": offer, "candidates": []string{}})
		err := doJSONWithClient(ctx, client, "POST", "http://tgent.local/api/v1/rtc/offer", "", body, &out, nil)
		return out, err
	})
}

func localSocketHTTPClient(socketPath string, timeout time.Duration) (*http.Client, *http.Transport) {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socketPath)
		},
	}
	return &http.Client{Transport: transport, Timeout: timeout}, transport
}

func connectHub(ctx context.Context, s *store, agentID string, req ConnectRequest, progress connectionProgress) (*transport, error) {
	progress = whileActive(ctx, progress)
	progress("正在检查 P2P 登录状态...")
	if !jwtValid(req.WebToken, 5*time.Minute) && req.Refresh != "" {
		progress("登录状态即将过期，正在刷新凭据...")
		var refreshed struct {
			Token        string `json:"token"`
			RefreshToken string `json:"refresh_token"`
		}
		body, _ := json.Marshal(map[string]string{"refresh_token": req.Refresh})
		headers := map[string]string{"X-Client-Type": "app"}
		if err := doJSON(ctx, "POST", strings.TrimRight(req.WebURL, "/")+"/api/auth/refresh", "", body, &refreshed, 10*time.Second, headers); err != nil {
			return nil, err
		}
		if refreshed.Token == "" {
			return nil, authError{"登录已过期，请重新登录"}
		}
		req.WebToken = refreshed.Token
		if refreshed.RefreshToken != "" {
			req.Refresh = refreshed.RefreshToken
		}
		s.mu.Lock()
		s.req.WebToken = req.WebToken
		s.req.Refresh = req.Refresh
		s.mu.Unlock()
		s.engine.emit(Event{Type: "token_update", Token: req.WebToken, Refresh: req.Refresh})
	}
	var local localServer
	if len(req.LocalServer) > 0 {
		_ = json.Unmarshal(req.LocalServer, &local)
	}
	progress("正在准备 P2P 安全认证...")
	seed, err := loadSeed(ctx, agentID, local, req)
	if err != nil {
		return nil, err
	}
	progress("正在获取 P2P 连接信息...")
	priv := ed25519.NewKeyFromSeed(seed)
	var info struct {
		HubURL     string `json:"hubHttpUrl"`
		HubToken   string `json:"hubToken"`
		AllowRelay bool   `json:"allowRelayTransfer"`
	}
	url := strings.TrimRight(req.WebURL, "/") + "/api/agents/" + agentID + "/connect"
	if err = doJSON(ctx, "POST", url, bearer(req.WebToken), nil, &info, 10*time.Second, nil); err != nil {
		return nil, err
	}
	progress("正在获取 ICE 服务器配置...")
	var cfg iceConfig
	if err = doJSON(ctx, "GET", strings.TrimRight(info.HubURL, "/")+"/api/v1/rtc/config", bearer(info.HubToken), nil, &cfg, 8*time.Second, nil); err != nil {
		return nil, err
	}
	servers := make([]webrtc.ICEServer, 0, len(cfg.IceServers))
	for _, v := range cfg.IceServers {
		servers = append(servers, webrtc.ICEServer{URLs: v.URLs, Username: v.Username, Credential: v.Credential})
	}
	tr, err := establish(ctx, s, servers, "P2P", progress, func(offer string) (answer, error) {
		now := time.Now().Unix()
		sig := ed25519.Sign(priv, []byte(fmt.Sprintf("%s:%d", info.HubToken, now)))
		auth := "Bearer " + info.HubToken + "::" + fmt.Sprint(now) + "::" + base64.StdEncoding.EncodeToString(sig)
		h := sha256.Sum256([]byte(offer))
		nonceBytes := make([]byte, 16)
		_, _ = rand.Read(nonceBytes)
		nonce := hex.EncodeToString(nonceBytes)
		msg := fmt.Sprintf("webrtc:offer:%s:%s:%d", hex.EncodeToString(h[:]), nonce, now)
		cmdSig := base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte(msg)))
		headers := map[string]string{"X-Command-Signature": cmdSig, "X-Command-Nonce": nonce, "X-Command-Timestamp": fmt.Sprint(now)}
		var out answer
		body, _ := json.Marshal(map[string]any{"sdp": offer, "candidates": []string{}})
		err := doJSON(ctx, "POST", strings.TrimRight(info.HubURL, "/")+"/api/v1/servers/"+agentID+"/rtc/offer", auth, body, &out, 18*time.Second, headers)
		return out, err
	})
	if tr != nil {
		tr.allowRelay = info.AllowRelay
	}
	return tr, err
}

func establish(ctx context.Context, s *store, servers []webrtc.ICEServer, kind string, progress connectionProgress, signal func(string) (answer, error)) (*transport, error) {
	progress(fmt.Sprintf("正在创建%s WebRTC 会话...", kind))
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{ICEServers: servers})
	if err != nil {
		return nil, err
	}
	t := &transport{
		store: s, pc: pc, channels: make(map[string]*webrtc.DataChannel),
		bridgeLabels: make(map[string]string), healthPending: make(map[string]*healthPending),
	}
	t.lastRTTMs.Store(200)
	connected := make(chan struct{})
	failed := make(chan error, 1)
	var once sync.Once
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("mobile WebRTC %s peer connection state: %s", s.key, state)
		switch state {
		case webrtc.PeerConnectionStateConnected:
			once.Do(func() { t.connectedAt = time.Now(); close(connected) })
			t.onPeerConnected()
		case webrtc.PeerConnectionStateDisconnected:
			t.onPeerDisconnected()
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			select {
			case failed <- fmt.Errorf("peer connection %s", state):
			default:
			}
			t.closed()
		}
	})
	pc.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		log.Printf("mobile WebRTC %s ICE connection state: %s", s.key, state)
		switch state {
		case webrtc.ICEConnectionStateChecking:
			progress("正在检查可用网络路径（ICE）...")
		case webrtc.ICEConnectionStateConnected, webrtc.ICEConnectionStateCompleted:
			progress("网络路径已建立，正在确认数据通道...")
		}
	})
	pc.OnSignalingStateChange(func(state webrtc.SignalingState) {
		log.Printf("mobile WebRTC %s signaling state: %s", s.key, state)
	})
	for _, label := range []string{"api", "events"} {
		dc, e := pc.CreateDataChannel(label, nil)
		if e != nil {
			pc.Close()
			return nil, e
		}
		t.bind(label, label+":"+s.key, dc)
	}
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		pc.Close()
		return nil, err
	}
	gather := webrtc.GatheringCompletePromise(pc)
	progress("正在收集网络候选（ICE）...")
	if err = pc.SetLocalDescription(offer); err != nil {
		pc.Close()
		return nil, err
	}
	select {
	case <-gather:
		log.Printf("mobile WebRTC %s ICE gathering complete", s.key)
	case <-time.After(8 * time.Second):
	case <-ctx.Done():
		pc.Close()
		return nil, ctx.Err()
	}
	progress("正在交换连接信令...")
	out, err := signal(pc.LocalDescription().SDP)
	if err != nil {
		pc.Close()
		return nil, err
	}
	if out.SDP == "" {
		pc.Close()
		return nil, errors.New("signaling response missing sdp")
	}
	if err = pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: out.SDP}); err != nil {
		pc.Close()
		return nil, err
	}
	progress(fmt.Sprintf("信令交换完成，正在建立%s通道...", kind))
	select {
	case <-connected:
		progress("连接路径已建立，正在打开数据通道...")
		if err := t.waitChannelOpen(ctx, "api", 5*time.Second); err != nil {
			pc.Close()
			return nil, err
		}
		return t, nil
	case err = <-failed:
		pc.Close()
		return nil, err
	case <-time.After(18 * time.Second):
		pc.Close()
		return nil, fmt.Errorf("connection timeout")
	case <-ctx.Done():
		pc.Close()
		return nil, ctx.Err()
	}
}

func uniqueAddresses(local localServer) []string {
	seen := make(map[string]struct{})
	addresses := make([]string, 0, 1+len(local.LocalAddrs))
	for _, candidate := range append([]string{local.Addr}, local.LocalAddrs...) {
		candidate = strings.TrimRight(strings.TrimSpace(candidate), "/")
		if candidate == "" {
			continue
		}
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		addresses = append(addresses, candidate)
	}
	return addresses
}

func whileActive(ctx context.Context, progress connectionProgress) connectionProgress {
	return func(status string) {
		if ctx.Err() == nil {
			progress(status)
		}
	}
}

func probeLocalAddresses(ctx context.Context, addresses []string) string {
	if len(addresses) == 0 {
		return ""
	}
	probeCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan string, len(addresses))
	for _, candidate := range addresses {
		go func(address string) {
			req, _ := http.NewRequestWithContext(probeCtx, "GET", address+"/api/v1/status", nil)
			resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
			if err == nil {
				resp.Body.Close()
				results <- address
				return
			}
			results <- ""
		}(candidate)
	}
	for range addresses {
		select {
		case address := <-results:
			if address != "" {
				cancel()
				return address
			}
		case <-ctx.Done():
			return ""
		}
	}
	return ""
}

func raceConnections(ctx context.Context, s *store, local localServer, req ConnectRequest) (*transport, string, error) {
	raceCtx, cancel := context.WithCancel(ctx)
	results := make(chan connectionResult, 2)
	progress := func(prefix string) connectionProgress {
		return func(message string) {
			if raceCtx.Err() == nil {
				s.progress(prefix + message)
			}
		}
	}
	go func() {
		tr, err := connectLocal(raceCtx, s, local, progress("本地连接："))
		results <- connectionResult{transport: tr, mode: "local", err: err}
	}()
	go func() {
		tr, err := connectHub(raceCtx, s, local.HubAgentID, req, progress("P2P 连接："))
		results <- connectionResult{transport: tr, mode: "p2p", err: err}
	}()

	errorsSeen := make([]error, 0, 2)
	for len(errorsSeen) < 2 {
		select {
		case result := <-results:
			if result.err == nil && result.transport != nil {
				cancel()
				if len(errorsSeen) == 0 {
					go func(winner *transport) {
						other := <-results
						if other.transport != nil && other.transport != winner {
							other.transport.close()
						}
					}(result.transport)
				}
				return result.transport, result.mode, nil
			}
			errorsSeen = append(errorsSeen, result.err)
			if len(errorsSeen) == 1 {
				if result.mode == "local" {
					s.progress("本地连接暂未建立，继续尝试 P2P...")
				} else {
					s.progress("P2P 连接暂未建立，继续尝试本地地址...")
				}
			}
		case <-ctx.Done():
			cancel()
			return nil, "", ctx.Err()
		}
	}
	cancel()
	for _, err := range errorsSeen {
		if isAuthError(err) {
			return nil, "", err
		}
	}
	return nil, "", errors.Join(errorsSeen...)
}

func (t *transport) waitChannelOpen(ctx context.Context, label string, timeout time.Duration) error {
	deadline := time.NewTimer(timeout)
	ticker := time.NewTicker(20 * time.Millisecond)
	defer deadline.Stop()
	defer ticker.Stop()
	for {
		t.mu.RLock()
		dc := t.channels[label]
		t.mu.RUnlock()
		if dc != nil && dc.ReadyState() == webrtc.DataChannelStateOpen {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return fmt.Errorf("%s data channel open timeout", label)
		case <-ticker.C:
		}
	}
}

func (t *transport) bind(dcLabel, bridgeLabel string, dc *webrtc.DataChannel) {
	t.mu.Lock()
	t.channels[dcLabel] = dc
	t.bridgeLabels[dcLabel] = bridgeLabel
	t.mu.Unlock()
	dc.OnMessage(func(msg webrtc.DataChannelMessage) {
		if dcLabel == "api" {
			t.handleHealthResponse(msg.Data)
		}
		t.store.engine.bridge.forward(bridgeLabel, msg.Data)
	})
	dc.OnClose(func() {
		t.mu.Lock()
		delete(t.channels, dcLabel)
		delete(t.bridgeLabels, dcLabel)
		t.mu.Unlock()
		if dcLabel == "api" || dcLabel == "events" {
			t.closed()
		}
	})
}
func (t *transport) openChannel(dcLabel, bridgeLabel string) error {
	t.mu.RLock()
	existing := t.channels[dcLabel]
	t.mu.RUnlock()
	if existing != nil {
		return nil
	}
	dc, err := t.pc.CreateDataChannel(dcLabel, nil)
	if err != nil {
		return err
	}
	t.bind(dcLabel, bridgeLabel, dc)
	opened := make(chan struct{})
	dc.OnOpen(func() { close(opened) })
	select {
	case <-opened:
		return nil
	case <-time.After(5 * time.Second):
		return fmt.Errorf("data channel open timeout")
	}
}
func (t *transport) send(label string, payload []byte) error {
	t.mu.RLock()
	dc := t.channels[label]
	t.mu.RUnlock()
	if dc == nil {
		return fmt.Errorf("channel %s not open", label)
	}
	err := dc.Send(payload)
	if err != nil {
		go t.closed()
	}
	return err
}
func (t *transport) closeChannel(label string) {
	t.mu.RLock()
	dc := t.channels[label]
	t.mu.RUnlock()
	if dc != nil {
		_ = dc.Close()
	}
}
func (t *transport) close() {
	t.closeOnce.Do(func() {
		t.stopHealthMonitor()
		t.failHealthPending(errors.New("transport closed"))
		_ = t.pc.Close()
	})
}
func (t *transport) closed() {
	t.notifyOnce.Do(func() {
		if t.onClosed != nil {
			go t.onClosed()
		}
		go t.close()
	})
}

func (t *transport) hasPeerConnection() bool { return t.pc != nil }

func (t *transport) isPeerConnected() bool {
	return t.pc != nil && t.pc.ConnectionState() == webrtc.PeerConnectionStateConnected
}

func (t *transport) lastRTT() time.Duration {
	return time.Duration(t.lastRTTMs.Load()) * time.Millisecond
}

func healthProbeTimeout(rtt time.Duration) time.Duration {
	timeout := rtt * 3
	if timeout < 500*time.Millisecond {
		return 500 * time.Millisecond
	}
	if timeout > 3*time.Second {
		return 3 * time.Second
	}
	return timeout
}

func (t *transport) startHealthMonitor() {
	t.healthMu.Lock()
	if t.healthCancel != nil {
		t.healthCancel()
	}
	ctx, cancel := context.WithCancel(t.store.engine.ctx)
	t.healthCancel = cancel
	t.healthMu.Unlock()
	go func() {
		ticker := time.NewTicker(healthInterval)
		defer ticker.Stop()
		failures := 0
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				err := t.probeStatus(healthProbeTimeout(t.lastRTT()))
				if err == nil {
					failures = 0
					continue
				}
				failures++
				if failures >= healthMaxFails {
					t.closed()
					return
				}
			}
		}
	}()
}

func (t *transport) stopHealthMonitor() {
	t.healthMu.Lock()
	if t.healthCancel != nil {
		t.healthCancel()
		t.healthCancel = nil
	}
	if t.graceCancel != nil {
		t.graceCancel()
		t.graceCancel = nil
	}
	t.healthMu.Unlock()
}

func (t *transport) onPeerConnected() {
	t.healthMu.Lock()
	if t.graceCancel != nil {
		t.graceCancel()
		t.graceCancel = nil
	}
	t.healthMu.Unlock()
}

func (t *transport) onPeerDisconnected() {
	if t.onClosed == nil {
		return
	}
	t.healthMu.Lock()
	if t.graceCancel != nil {
		t.healthMu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(t.store.engine.ctx)
	t.graceCancel = cancel
	t.healthMu.Unlock()
	grace := 5 * time.Second
	if !t.connectedAt.IsZero() && time.Since(t.connectedAt) < 15*time.Second {
		grace = 12 * time.Second
	}
	go func() {
		if err := t.probeStatus(healthProbeTimeout(t.lastRTT())); err != nil && !t.isPeerConnected() {
			t.closed()
			return
		}
		select {
		case <-time.After(grace):
			if !t.isPeerConnected() {
				t.closed()
			}
		case <-ctx.Done():
		}
	}()
}

func (t *transport) probeStatus(timeout time.Duration) error {
	if t.pc == nil {
		return errors.New("peer connection unavailable")
	}
	t.mu.RLock()
	dc := t.channels["api"]
	t.mu.RUnlock()
	if dc == nil || dc.ReadyState() != webrtc.DataChannelStateOpen {
		return errors.New("api data channel is not open")
	}
	id := fmt.Sprintf("health-%d", t.healthSeq.Add(1))
	pending := &healthPending{done: make(chan error, 1)}
	t.healthMu.Lock()
	t.healthPending[id] = pending
	t.healthMu.Unlock()
	payload, _ := json.Marshal(map[string]any{"id": id, "method": "GET", "path": "/status", "body": nil})
	started := time.Now()
	if err := dc.Send(payload); err != nil {
		t.removeHealthPending(id)
		return err
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case err := <-pending.done:
		if err == nil {
			t.lastRTTMs.Store(max(time.Since(started).Milliseconds(), 1))
		}
		return err
	case <-timer.C:
		t.removeHealthPending(id)
		return errors.New("health probe timeout")
	case <-t.store.engine.ctx.Done():
		t.removeHealthPending(id)
		return t.store.engine.ctx.Err()
	}
}

func (t *transport) handleHealthResponse(payload []byte) {
	if len(payload) < 3 || payload[0] != apiChunkMagic {
		return
	}
	flags, idLen := payload[1], int(payload[2])
	if len(payload) < 3+idLen {
		return
	}
	id := string(payload[3 : 3+idLen])
	t.healthMu.Lock()
	pending := t.healthPending[id]
	if pending == nil {
		t.healthMu.Unlock()
		return
	}
	if flags&apiChunkFirst != 0 {
		pending.chunks = nil
	}
	pending.chunks = append(pending.chunks, append([]byte(nil), payload[3+idLen:]...))
	if flags&apiChunkLast == 0 {
		t.healthMu.Unlock()
		return
	}
	delete(t.healthPending, id)
	chunks := pending.chunks
	t.healthMu.Unlock()
	data := bytes.Join(chunks, nil)
	var response struct {
		Status int `json:"status"`
	}
	err := json.Unmarshal(data, &response)
	if err == nil && (response.Status < 200 || response.Status >= 500) {
		err = fmt.Errorf("health probe status %d", response.Status)
	}
	pending.done <- err
}

func (t *transport) removeHealthPending(id string) {
	t.healthMu.Lock()
	delete(t.healthPending, id)
	t.healthMu.Unlock()
}

func (t *transport) failHealthPending(err error) {
	t.healthMu.Lock()
	pending := t.healthPending
	t.healthPending = make(map[string]*healthPending)
	t.healthMu.Unlock()
	for _, request := range pending {
		select {
		case request.done <- err:
		default:
		}
	}
}
func loadSeed(ctx context.Context, agentID string, local localServer, req ConnectRequest) ([]byte, error) {
	if local.PrivateKeySeed != "" {
		b, e := base64.StdEncoding.DecodeString(local.PrivateKeySeed)
		if e == nil && len(b) == ed25519.SeedSize {
			return b, nil
		}
	}
	if local.PairCode == "" {
		return nil, authError{"需要扫码配对后才能连接"}
	}
	var enc struct {
		Cipher string `json:"encrypted_private_key"`
		Nonce  string `json:"key_nonce"`
	}
	url := strings.TrimRight(req.WebURL, "/") + "/api/agents/" + agentID + "/encrypted-key"
	if err := doJSON(ctx, "GET", url, bearer(req.WebToken), nil, &enc, 10*time.Second, nil); err != nil {
		return nil, err
	}
	key := pbkdf2.Key([]byte(local.PairCode), []byte(agentID), 100000, 32, sha256.New)
	ciphertext, err := base64.StdEncoding.DecodeString(enc.Cipher)
	if err != nil {
		return nil, err
	}
	nonce, err := base64.StdEncoding.DecodeString(enc.Nonce)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, nonce, ciphertext, nil)
}

type authError struct{ message string }

func (e authError) Error() string { return e.message }
func isAuthError(err error) bool  { var target authError; return errors.As(err, &target) }
func bearer(token string) string {
	if token == "" {
		return ""
	}
	return "Bearer " + token
}

func jwtValid(token string, margin time.Duration) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if json.Unmarshal(payload, &claims) != nil || claims.Exp == 0 {
		return false
	}
	return time.Unix(claims.Exp, 0).After(time.Now().Add(margin))
}
func doJSON(ctx context.Context, method, url, auth string, body []byte, out any, timeout time.Duration, headers map[string]string) error {
	return doJSONWithClient(ctx, &http.Client{Timeout: timeout}, method, url, auth, body, out, headers)
}

func doJSONWithClient(ctx context.Context, client *http.Client, method, url, auth string, body []byte, out any, headers map[string]string) error {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return authError{"需要登录"}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("http %d: %s", resp.StatusCode, string(data))
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}
