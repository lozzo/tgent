package main

import (
	"encoding/json"
	"testing"
)

func TestInjectLocalTGentSocketAccess(t *testing.T) {
	payload := `{"action":"connect","serverType":"local","serverId":"local","localServer":{"addr":"http://localhost:8080","password":"stored-password"}}`
	access := LocalTGentAccess{
		Found:           true,
		Address:         "http://127.0.0.1:8080",
		SocketAvailable: true,
		SocketPath:      "/tmp/tgent.sock",
		AuthEnabled:     true,
		WebPassword:     "web-password",
	}

	local := decodeLocalServerFromCommand(t, injectLocalTGentAccess(payload, access))
	if local["socketPath"] != "/tmp/tgent.sock" || local["password"] != "" {
		t.Fatalf("unexpected injected local server: %+v", local)
	}
}

func TestInjectLocalTGentLegacyPassword(t *testing.T) {
	payload := `{"action":"connect","serverType":"local","serverId":"local","localServer":{"addr":"http://127.0.0.1:8080","password":""}}`
	access := LocalTGentAccess{
		Found:       true,
		Address:     "http://127.0.0.1:8080",
		AuthEnabled: true,
		WebPassword: "web-password",
	}

	local := decodeLocalServerFromCommand(t, injectLocalTGentAccess(payload, access))
	if local["password"] != "web-password" {
		t.Fatalf("legacy password was not injected: %+v", local)
	}
}

func TestInjectLocalTGentDoesNotTouchRemoteAddress(t *testing.T) {
	payload := `{"action":"connect","serverType":"local","serverId":"remote","localServer":{"addr":"http://192.168.1.20:8080","password":"remote-password"}}`
	access := LocalTGentAccess{
		Found:       true,
		Address:     "http://127.0.0.1:8080",
		AuthEnabled: true,
		WebPassword: "web-password",
	}
	if actual := injectLocalTGentAccess(payload, access); actual != payload {
		t.Fatalf("remote command was modified: %s", actual)
	}
}

func decodeLocalServerFromCommand(t *testing.T, payload string) map[string]any {
	t.Helper()
	var envelope struct {
		LocalServer map[string]any `json:"localServer"`
	}
	if err := json.Unmarshal([]byte(payload), &envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.LocalServer
}
