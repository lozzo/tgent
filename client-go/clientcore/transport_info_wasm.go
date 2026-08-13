//go:build js && wasm

package clientcore

import (
	"math"
	"net"
	"strconv"
	"syscall/js"

	"github.com/pion/webrtc/v4"
)

func (t *transport) connectionInfo() map[string]any {
	if t.pc.ConnectionState() != webrtc.PeerConnectionStateConnected {
		return map[string]any{"type": "unknown"}
	}
	t.refreshConnectionInfo()
	t.infoMu.RLock()
	defer t.infoMu.RUnlock()
	if t.info == nil {
		return map[string]any{"type": "unknown"}
	}
	result := make(map[string]any, len(t.info))
	for key, value := range t.info {
		result[key] = value
	}
	return result
}

func (t *transport) refreshConnectionInfo() {
	t.infoMu.Lock()
	if t.infoLoading {
		t.infoMu.Unlock()
		return
	}
	t.infoLoading = true
	t.infoMu.Unlock()

	promise := t.pc.JSValue().Call("getStats")
	var resolve js.Func
	var reject js.Func
	finish := func() {
		t.infoMu.Lock()
		t.infoLoading = false
		t.infoMu.Unlock()
		resolve.Release()
		reject.Release()
	}
	resolve = js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) > 0 {
			if info, ok := browserConnectionInfo(args[0]); ok {
				t.infoMu.Lock()
				t.info = info
				t.infoMu.Unlock()
			}
		}
		finish()
		return nil
	})
	reject = js.FuncOf(func(_ js.Value, _ []js.Value) any {
		finish()
		return nil
	})
	promise.Call("then", resolve).Call("catch", reject)
}

func browserConnectionInfo(report js.Value) (map[string]any, bool) {
	stats := make(map[string]js.Value)
	var collect js.Func
	collect = js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) > 0 {
			stat := args[0]
			id := jsString(stat, "id")
			if id != "" {
				stats[id] = stat
			}
		}
		return nil
	})
	report.Call("forEach", collect)
	collect.Release()

	var pair js.Value
	for _, stat := range stats {
		if jsString(stat, "type") == "candidate-pair" && jsString(stat, "state") == "succeeded" && stat.Get("nominated").Truthy() {
			pair = stat
			break
		}
	}
	if pair.IsUndefined() || pair.IsNull() {
		return nil, false
	}
	local := stats[jsString(pair, "localCandidateId")]
	remote := stats[jsString(pair, "remoteCandidateId")]
	localType := jsString(local, "candidateType")
	remoteType := jsString(remote, "candidateType")
	connectionType := "p2p"
	if localType == "relay" || remoteType == "relay" {
		connectionType = "relay"
	}
	info := map[string]any{"type": connectionType}
	if rtt := pair.Get("currentRoundTripTime"); rtt.Type() == js.TypeNumber {
		info["rtt"] = int64(math.Round(rtt.Float() * 1000))
	}
	addBrowserCandidate(info, local, "localAddr", "candidateType")
	addBrowserCandidate(info, remote, "remoteAddr", "remoteCandidateType")
	return info, true
}

func addBrowserCandidate(info map[string]any, candidate js.Value, addressKey, typeKey string) {
	if candidate.IsUndefined() || candidate.IsNull() {
		return
	}
	address := jsString(candidate, "address")
	if address == "" {
		address = jsString(candidate, "ip")
	}
	port := candidate.Get("port")
	if address != "" && port.Type() == js.TypeNumber {
		info[addressKey] = net.JoinHostPort(address, strconv.Itoa(port.Int()))
	}
	if candidateType := jsString(candidate, "candidateType"); candidateType != "" {
		info[typeKey] = candidateType
	}
}

func jsString(value js.Value, key string) string {
	if value.IsUndefined() || value.IsNull() {
		return ""
	}
	field := value.Get(key)
	if field.Type() != js.TypeString {
		return ""
	}
	return field.String()
}
