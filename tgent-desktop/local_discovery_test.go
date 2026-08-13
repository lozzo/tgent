package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestLoopbackAddress(t *testing.T) {
	tests := map[string]string{
		":8080":                 "http://127.0.0.1:8080",
		"0.0.0.0:30233":         "http://127.0.0.1:30233",
		"http://localhost:9000": "http://127.0.0.1:9000",
		"invalid":               "",
	}
	for input, expected := range tests {
		if actual := loopbackAddress(input); actual != expected {
			t.Fatalf("loopbackAddress(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestProbeLocalTGentWithoutPassword(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/status" {
			http.NotFound(writer, request)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"status":"ok","tmux_running":true}`))
	}))
	defer server.Close()

	result := probeLocalTGent(context.Background(), []string{server.URL}, server.Client())
	if !result.found || result.requiresPassword || result.address != server.URL {
		t.Fatalf("unexpected discovery result: %+v", result)
	}
}

func TestProbeLocalTGentPasswordChallenge(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	client := server.Client()
	client.Timeout = time.Second
	result := probeLocalTGent(context.Background(), []string{server.URL}, client)
	if !result.found || !result.requiresPassword {
		t.Fatalf("unexpected discovery result: %+v", result)
	}
}

func TestProbeLocalTGentRejectsUnrelatedHTTPService(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"status":"healthy"}`))
	}))
	defer server.Close()

	result := probeLocalTGent(context.Background(), []string{server.URL}, server.Client())
	if result.found {
		t.Fatalf("unrelated service was identified as TGent: %+v", result)
	}
}

func TestValidateLocalTGentPassword(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/api/v1/agent/status" {
			if request.Header.Get("Authorization") != "Bearer local-token" {
				t.Fatalf("agent status authorization = %q", request.Header.Get("Authorization"))
			}
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"agent_id":"agent-password","hub_addr":"https://hub.example"}`))
			return
		}
		if request.URL.Path != "/api/v1/auth/login" {
			http.NotFound(writer, request)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"token":"local-token"}`))
	}))
	defer server.Close()

	result := (&App{}).ValidateLocalTGent(server.URL, "daemon-password")
	if !result.OK || result.Error != "" || result.AgentID != "agent-password" || result.HubAddr != "https://hub.example" {
		t.Fatalf("unexpected validation result: %+v", result)
	}
}

func TestValidateLocalTGentDiscoversAgentIdentityWithoutPassword(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/api/v1/status":
			_, _ = writer.Write([]byte(`{"status":"ok"}`))
		case "/api/v1/agent/status":
			_, _ = writer.Write([]byte(`{"agent_id":"agent-direct","hub_addr":"https://hub.example"}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	result := (&App{}).ValidateLocalTGent(server.URL, "")
	if !result.OK || result.AgentID != "agent-direct" || result.HubAddr != "https://hub.example" {
		t.Fatalf("unexpected validation result: %+v", result)
	}
}

func TestValidateLocalTGentRequiresPassword(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	result := (&App{}).ValidateLocalTGent(server.URL, "")
	if result.OK || !result.RequiresPassword {
		t.Fatalf("unexpected validation result: %+v", result)
	}
}

func TestValidateLocalTGentUsesSameUserSocketPasswordForLoopback(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix socket test")
	}
	httpServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/api/v1/status":
			writer.WriteHeader(http.StatusUnauthorized)
		case "/api/v1/auth/login":
			var payload map[string]string
			_ = json.NewDecoder(request.Body).Decode(&payload)
			if payload["password"] != "socket-password" {
				writer.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = writer.Write([]byte(`{"token":"socket-token"}`))
		case "/api/v1/agent/status":
			_, _ = writer.Write([]byte(`{"agent_id":"agent-socket"}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer httpServer.Close()

	home, err := os.MkdirTemp("/tmp", "tgent-home-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(home) })
	t.Setenv("HOME", home)
	socketDir := filepath.Join(home, ".tgent")
	if err := os.MkdirAll(socketDir, 0o700); err != nil {
		t.Fatal(err)
	}
	socketPath := filepath.Join(socketDir, "tgent.sock")
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(socketPath, 0o600); err != nil {
		t.Fatal(err)
	}
	socketServer := &http.Server{Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/local/credentials" {
			http.NotFound(writer, request)
			return
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"authEnabled": true,
			"password":    "socket-password",
			"listen":      httpServer.URL,
		})
	})}
	go func() { _ = socketServer.Serve(listener) }()
	t.Cleanup(func() {
		_ = socketServer.Close()
		_ = listener.Close()
	})

	result := (&App{}).ValidateLocalTGent(httpServer.URL, "")
	if !result.OK || result.RequiresPassword || result.AgentID != "agent-socket" {
		t.Fatalf("unexpected validation result: %+v", result)
	}
}

func TestReadOwnerOnlySecretRejectsGroupReadableFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "password")
	if err := os.WriteFile(path, []byte("saved-password\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	password, ok := readOwnerOnlySecret(path)
	if !ok || password != "saved-password" {
		t.Fatalf("readOwnerOnlySecret() = %q, %v", password, ok)
	}
	if err := os.Chmod(path, 0o640); err != nil {
		t.Fatal(err)
	}
	if _, ok := readOwnerOnlySecret(path); ok {
		t.Fatal("group-readable secret should be rejected")
	}
}

func TestCredentialsFromSecureLocalSocket(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix socket test")
	}
	directory, err := os.MkdirTemp("/tmp", "tgent-desktop-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(directory)
	path := filepath.Join(directory, "tgent.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/local/credentials" {
			http.NotFound(writer, request)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"authEnabled": true,
			"password":    "web-password",
			"listen":      ":8080",
			"name":        "workstation",
			"agentId":     "agent-local",
			"hubAddr":     "https://hub.example",
		})
	})}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() {
		_ = server.Close()
		_ = listener.Close()
	})

	credentials, ok := credentialsFromLocalSocket(context.Background(), path)
	if !ok || !credentials.AuthEnabled || credentials.Password != "web-password" || credentials.AgentID != "agent-local" || credentials.HubAddr != "https://hub.example" {
		t.Fatalf("unexpected credentials: %+v, ok=%v", credentials, ok)
	}
}

func TestLocalTGentAccessJSONDoesNotExposePassword(t *testing.T) {
	payload, err := json.Marshal(LocalTGentAccess{
		Found:             true,
		AuthEnabled:       true,
		PasswordAvailable: true,
		WebPassword:       "secret-password",
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), "secret-password") || strings.Contains(string(payload), "webPassword") {
		t.Fatalf("access metadata exposed password: %s", payload)
	}
	if !strings.Contains(string(payload), `"passwordAvailable":true`) {
		t.Fatalf("access metadata omitted password availability: %s", payload)
	}
}
