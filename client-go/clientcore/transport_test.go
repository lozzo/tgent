//go:build !js || !wasm

package clientcore

import (
	"context"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

func testJWT(exp int64) string {
	payload := base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(`{"exp":%d}`, exp)))
	return "e30." + payload + ".signature"
}

func TestLocalSocketHTTPClient(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix socket test")
	}
	path := filepath.Join(t.TempDir(), "tgent.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/status" {
			http.NotFound(writer, request)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"status":"ok"}`))
	})}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() {
		_ = server.Close()
		_ = listener.Close()
	})

	client, transport := localSocketHTTPClient(path, time.Second)
	defer transport.CloseIdleConnections()
	var status struct {
		Status string `json:"status"`
	}
	if err := doJSONWithClient(context.Background(), client, http.MethodGet, "http://tgent.local/api/v1/status", "", nil, &status, nil); err != nil {
		t.Fatal(err)
	}
	if status.Status != "ok" {
		t.Fatalf("status = %q", status.Status)
	}
}

func TestTransportFailureNotifiesAndClosesOnce(t *testing.T) {
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	engine := &Engine{ctx: ctx, cancel: cancel, events: make(chan Event, 1)}
	store := &store{engine: engine}
	tr := &transport{
		store: store, pc: pc, channels: make(map[string]*webrtc.DataChannel),
		bridgeLabels: make(map[string]string), healthPending: make(map[string]*healthPending),
	}
	var notifications atomic.Int32
	done := make(chan struct{})
	tr.onClosed = func() {
		if notifications.Add(1) == 1 {
			close(done)
		}
	}
	tr.closed()
	tr.closed()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("disconnect callback was not called")
	}
	deadline := time.Now().Add(time.Second)
	for pc.ConnectionState() != webrtc.PeerConnectionStateClosed && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if notifications.Load() != 1 {
		t.Fatalf("disconnect callback called %d times", notifications.Load())
	}
	if pc.ConnectionState() != webrtc.PeerConnectionStateClosed {
		t.Fatalf("peer connection was not closed: %s", pc.ConnectionState())
	}
}

func TestEstablishCreatesWorkingDataChannels(t *testing.T) {
	remote, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer remote.Close()
	received := make(chan string, 1)
	remote.OnDataChannel(func(dc *webrtc.DataChannel) {
		if dc.Label() == "api" {
			dc.OnMessage(func(msg webrtc.DataChannelMessage) { received <- string(msg.Data) })
		}
	})

	engine := &Engine{ctx: context.Background(), events: make(chan Event, 4)}
	store := &store{engine: engine, key: "local:test"}
	progress := make(chan string, 32)
	tr, err := establish(context.Background(), store, nil, "test", func(status string) {
		select {
		case progress <- status:
		default:
		}
	}, func(offer string) (answer, error) {
		if err := remote.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offer}); err != nil {
			return answer{}, err
		}
		created, err := remote.CreateAnswer(nil)
		if err != nil {
			return answer{}, err
		}
		gather := webrtc.GatheringCompletePromise(remote)
		if err := remote.SetLocalDescription(created); err != nil {
			return answer{}, err
		}
		select {
		case <-gather:
		case <-time.After(5 * time.Second):
			return answer{}, fmt.Errorf("remote gathering timeout")
		}
		return answer{SDP: remote.LocalDescription().SDP}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer tr.close()

	var statuses []string
	for {
		select {
		case status := <-progress:
			statuses = append(statuses, status)
		default:
			goto drained
		}
	}

drained:
	joined := strings.Join(statuses, "\n")
	for _, stage := range []string{"ICE", "信令", "数据通道"} {
		if !strings.Contains(joined, stage) {
			t.Fatalf("progress did not include %q: %s", stage, joined)
		}
	}
	if err := tr.send("api", []byte("ping")); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-received:
		if got != "ping" {
			t.Fatalf("got %q", got)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("data channel message timeout")
	}
}

func TestProbeLocalAddressesUsesFirstResponsiveCandidate(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer slow.Close()
	fast := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer fast.Close()

	started := time.Now()
	got := probeLocalAddresses(context.Background(), []string{slow.URL, fast.URL})
	if got != fast.URL {
		t.Fatalf("selected %q, want %q", got, fast.URL)
	}
	if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
		t.Fatalf("parallel probe took too long: %s", elapsed)
	}
}

func TestConnectionInfoUsesSelectedRelayPair(t *testing.T) {
	report := webrtc.StatsReport{
		"transport": webrtc.TransportStats{SelectedCandidatePairID: "selected"},
		"selected":  webrtc.ICECandidatePairStats{ID: "selected", LocalCandidateID: "local", RemoteCandidateID: "remote", State: webrtc.StatsICECandidatePairStateSucceeded, CurrentRoundTripTime: 0.0126},
		"stale":     webrtc.ICECandidatePairStats{ID: "stale", LocalCandidateID: "stale-local", RemoteCandidateID: "stale-remote", State: webrtc.StatsICECandidatePairStateSucceeded},
		"local":     webrtc.ICECandidateStats{ID: "local", IP: "2001:db8::1", Port: 3478, CandidateType: webrtc.ICECandidateTypeRelay},
		"remote":    webrtc.ICECandidateStats{ID: "remote", IP: "192.0.2.5", Port: 5000, CandidateType: webrtc.ICECandidateTypeSrflx},
	}
	info := connectionInfoFromStats(report)
	if info["type"] != "relay" || info["rtt"] != int64(13) {
		t.Fatalf("unexpected relay info: %#v", info)
	}
	if info["localAddr"] != "[2001:db8::1]:3478" {
		t.Fatalf("unexpected IPv6 address: %#v", info["localAddr"])
	}
	if info["candidateType"] != "relay" || info["remoteCandidateType"] != "srflx" {
		t.Fatalf("unexpected candidate types: %#v", info)
	}
}

func TestConnectionInfoFallsBackToNominatedPair(t *testing.T) {
	report := webrtc.StatsReport{
		"pair":   webrtc.ICECandidatePairStats{ID: "pair", LocalCandidateID: "local", RemoteCandidateID: "remote", Nominated: true},
		"local":  webrtc.ICECandidateStats{ID: "local", IP: "10.0.0.2", Port: 4000, CandidateType: webrtc.ICECandidateTypeHost},
		"remote": webrtc.ICECandidateStats{ID: "remote", IP: "10.0.0.3", Port: 4001, CandidateType: webrtc.ICECandidateTypeHost},
	}
	info := connectionInfoFromStats(report)
	if info["type"] != "p2p" || info["localAddr"] != "10.0.0.2:4000" {
		t.Fatalf("unexpected info: %#v", info)
	}
}

func TestJWTValidityUsesSafetyMargin(t *testing.T) {
	if !jwtValid(testJWT(time.Now().Add(10*time.Minute).Unix()), 5*time.Minute) {
		t.Fatal("fresh token should be valid")
	}
	if jwtValid(testJWT(time.Now().Add(time.Minute).Unix()), 5*time.Minute) {
		t.Fatal("nearly expired token should be refreshed")
	}
	if jwtValid("invalid", 0) {
		t.Fatal("malformed token should be invalid")
	}
}
