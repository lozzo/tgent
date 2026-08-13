//go:build !js || !wasm

package clientcore

import (
	"net"
	"strconv"

	"github.com/pion/webrtc/v4"
)

func (t *transport) connectionInfo() map[string]any {
	if t.pc.ConnectionState() != webrtc.PeerConnectionStateConnected {
		return map[string]any{"type": "unknown"}
	}
	return connectionInfoFromStats(t.pc.GetStats())
}

func connectionInfoFromStats(report webrtc.StatsReport) map[string]any {
	var selectedID string
	for _, stat := range report {
		if transport, ok := stat.(webrtc.TransportStats); ok && transport.SelectedCandidatePairID != "" {
			selectedID = transport.SelectedCandidatePairID
			break
		}
	}

	var pair *webrtc.ICECandidatePairStats
	if selectedID != "" {
		if selected, ok := report[selectedID].(webrtc.ICECandidatePairStats); ok {
			pair = &selected
		}
	}
	if pair == nil {
		for _, stat := range report {
			candidatePair, ok := stat.(webrtc.ICECandidatePairStats)
			if !ok || (candidatePair.State != webrtc.StatsICECandidatePairStateSucceeded && !candidatePair.Nominated) {
				continue
			}
			pair = &candidatePair
			if candidatePair.Nominated {
				break
			}
		}
	}
	if pair == nil {
		return map[string]any{"type": "unknown"}
	}

	local, localOK := report[pair.LocalCandidateID].(webrtc.ICECandidateStats)
	remote, remoteOK := report[pair.RemoteCandidateID].(webrtc.ICECandidateStats)
	isRelay := (localOK && local.CandidateType == webrtc.ICECandidateTypeRelay) ||
		(remoteOK && remote.CandidateType == webrtc.ICECandidateTypeRelay)
	info := map[string]any{"type": "p2p", "rtt": int64(pair.CurrentRoundTripTime*1000 + 0.5)}
	if isRelay {
		info["type"] = "relay"
	}
	if localOK {
		info["localAddr"] = net.JoinHostPort(local.IP, strconv.Itoa(int(local.Port)))
		info["candidateType"] = local.CandidateType.String()
	}
	if remoteOK {
		info["remoteAddr"] = net.JoinHostPort(remote.IP, strconv.Itoa(int(remote.Port)))
		info["remoteCandidateType"] = remote.CandidateType.String()
	}
	return info
}
