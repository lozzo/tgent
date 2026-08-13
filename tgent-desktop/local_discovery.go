package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const localTGentProbeTimeout = 900 * time.Millisecond

type LocalTGentDiscovery struct {
	Found            bool   `json:"found"`
	Address          string `json:"address,omitempty"`
	Name             string `json:"name,omitempty"`
	SocketPath       string `json:"socketPath,omitempty"`
	RequiresPassword bool   `json:"requiresPassword,omitempty"`
	AgentID          string `json:"agentId,omitempty"`
	HubAddr          string `json:"hubAddr,omitempty"`
}

type LocalTGentAccess struct {
	Found             bool   `json:"found"`
	Address           string `json:"address,omitempty"`
	Name              string `json:"name,omitempty"`
	SocketAvailable   bool   `json:"socketAvailable"`
	SocketPath        string `json:"socketPath,omitempty"`
	AuthEnabled       bool   `json:"authEnabled"`
	PasswordAvailable bool   `json:"passwordAvailable"`
	WebPassword       string `json:"-"`
	AgentID           string `json:"agentId,omitempty"`
	HubAddr           string `json:"hubAddr,omitempty"`
}

type LocalTGentValidation struct {
	OK               bool   `json:"ok"`
	RequiresPassword bool   `json:"requiresPassword,omitempty"`
	Error            string `json:"error,omitempty"`
	AgentID          string `json:"agentId,omitempty"`
	HubAddr          string `json:"hubAddr,omitempty"`
}

type localTGentProcessInfo struct {
	Listen      string `json:"listen"`
	LocalSocket string `json:"local_socket"`
}

type localTGentProbeResult struct {
	index            int
	address          string
	found            bool
	requiresPassword bool
}

// DiscoverLocalTGent finds a TGent daemon owned by the current desktop user.
// Account authentication is intentionally unrelated to this local connection.
func (a *App) DiscoverLocalTGent() LocalTGentDiscovery {
	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "This computer"
	}

	ctx, cancel := context.WithTimeout(context.Background(), localTGentProbeTimeout)
	defer cancel()

	access := localTGentAccess(ctx)
	if access.SocketAvailable {
		return LocalTGentDiscovery{
			Found:      true,
			Address:    access.Address,
			Name:       hostname,
			SocketPath: access.SocketPath,
			AgentID:    access.AgentID,
			HubAddr:    access.HubAddr,
		}
	}

	result := probeLocalTGent(ctx, localTGentCandidates(), &http.Client{Timeout: localTGentProbeTimeout})
	var agentID, hubAddr string
	if result.found && (!result.requiresPassword || access.WebPassword != "") {
		password := ""
		if result.requiresPassword {
			password = access.WebPassword
		}
		validationCtx, validationCancel := context.WithTimeout(context.Background(), 5*time.Second)
		validation := validateLocalTGentHTTP(validationCtx, result.address, password)
		validationCancel()
		if validation.OK {
			result.requiresPassword = false
			agentID = validation.AgentID
			hubAddr = validation.HubAddr
		}
	}
	return LocalTGentDiscovery{
		Found:            result.found,
		Address:          result.address,
		Name:             hostname,
		RequiresPassword: result.requiresPassword,
		AgentID:          agentID,
		HubAddr:          hubAddr,
	}
}

// GetLocalTGentAccess returns local-only connection metadata. The Web password
// is exposed only to this same-user desktop process and remains hidden by UI
// until the user explicitly reveals or copies it.
func (a *App) GetLocalTGentAccess() LocalTGentAccess {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	access := localTGentAccess(ctx)
	if access.Found {
		return access
	}
	result := probeLocalTGent(ctx, localTGentCandidates(), &http.Client{Timeout: localTGentProbeTimeout})
	if result.found {
		access.Found = true
		access.Address = result.address
		access.AuthEnabled = result.requiresPassword
		if !result.requiresPassword {
			access.WebPassword = ""
			access.PasswordAvailable = false
		}
	}
	return access
}

// GetLocalTGentPassword reads the protected password only after an explicit
// reveal or copy action in the desktop UI.
func (a *App) GetLocalTGentPassword() (string, error) {
	access := a.GetLocalTGentAccess()
	if access.WebPassword == "" {
		return "", errors.New("no local Web password is available")
	}
	return access.WebPassword, nil
}

// ValidateLocalTGent verifies daemon access outside the WebView so Wails' custom
// origin never turns a valid local connection into a CORS failure.
func (a *App) ValidateLocalTGent(address, password string) LocalTGentValidation {
	address, ok := normalizeTGentAddress(address)
	if !ok {
		return LocalTGentValidation{Error: "invalid_address"}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	validation := validateLocalTGentHTTP(ctx, address, password)
	if password == "" && validation.RequiresPassword {
		access := localTGentAccess(ctx)
		if access.WebPassword != "" && sameLocalTGentAddress(address, access.Address) {
			return validateLocalTGentHTTP(ctx, address, access.WebPassword)
		}
	}
	return validation
}

func validateLocalTGentHTTP(ctx context.Context, address, password string) LocalTGentValidation {
	client := &http.Client{Timeout: 5 * time.Second}

	if password == "" {
		request, _ := http.NewRequestWithContext(ctx, http.MethodGet, address+"/api/v1/status", nil)
		response, err := client.Do(request)
		if err != nil {
			return LocalTGentValidation{Error: "connection_failed"}
		}
		if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
			response.Body.Close()
			return LocalTGentValidation{RequiresPassword: true}
		}
		if response.StatusCode != http.StatusOK {
			response.Body.Close()
			return LocalTGentValidation{Error: "not_tgent"}
		}
		var payload struct {
			Status string `json:"status"`
		}
		decodeErr := json.NewDecoder(response.Body).Decode(&payload)
		response.Body.Close()
		if decodeErr != nil || payload.Status != "ok" {
			return LocalTGentValidation{Error: "not_tgent"}
		}
		agentID, hubAddr := fetchTGentAgentIdentity(ctx, client, address, "")
		return LocalTGentValidation{OK: true, AgentID: agentID, HubAddr: hubAddr}
	}

	body, _ := json.Marshal(map[string]string{"password": password})
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, address+"/api/v1/auth/login", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return LocalTGentValidation{Error: "connection_failed"}
	}
	if response.StatusCode == http.StatusUnauthorized {
		response.Body.Close()
		return LocalTGentValidation{Error: "invalid_password"}
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return LocalTGentValidation{Error: "authentication_failed"}
	}
	var payload struct {
		Token string `json:"token"`
	}
	decodeErr := json.NewDecoder(response.Body).Decode(&payload)
	response.Body.Close()
	if decodeErr != nil || payload.Token == "" {
		return LocalTGentValidation{Error: "authentication_failed"}
	}
	agentID, hubAddr := fetchTGentAgentIdentity(ctx, client, address, payload.Token)
	return LocalTGentValidation{OK: true, AgentID: agentID, HubAddr: hubAddr}
}

func fetchTGentAgentIdentity(ctx context.Context, client *http.Client, address, token string) (string, string) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, address+"/api/v1/agent/status", nil)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := client.Do(request)
	if err != nil {
		return "", ""
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", ""
	}
	var payload struct {
		AgentID string `json:"agent_id"`
		HubAddr string `json:"hub_addr"`
	}
	if json.NewDecoder(response.Body).Decode(&payload) != nil {
		return "", ""
	}
	return payload.AgentID, payload.HubAddr
}

func normalizeTGentAddress(address string) (string, bool) {
	address = strings.TrimSpace(strings.TrimRight(address, "/"))
	parsed, err := url.Parse(address)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return "", false
	}
	return address, true
}

func sameLocalTGentAddress(left, right string) bool {
	left, leftOK := normalizeTGentAddress(left)
	right, rightOK := normalizeTGentAddress(right)
	if !leftOK || !rightOK {
		return false
	}
	if left == right {
		return true
	}
	leftURL, _ := url.Parse(left)
	rightURL, _ := url.Parse(right)
	return leftURL.Port() == rightURL.Port() && isLoopbackHost(leftURL.Hostname()) && isLoopbackHost(rightURL.Hostname())
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func localTGentCandidates() []string {
	candidates := make([]string, 0, 3)
	if info, ok := readLocalTGentProcessInfo(); ok {
		if address := loopbackAddress(info.Listen); address != "" {
			candidates = append(candidates, address)
		}
	}

	// 8080 is the current TGent default. 30233 remains for older installations.
	candidates = append(candidates, "http://127.0.0.1:8080", "http://127.0.0.1:30233")
	return uniqueStrings(candidates)
}

func readLocalTGentProcessInfo() (localTGentProcessInfo, bool) {
	home, err := os.UserHomeDir()
	if err != nil {
		return localTGentProcessInfo{}, false
	}
	data, err := os.ReadFile(filepath.Join(home, ".tgent", "tgent.pid"))
	if err != nil {
		return localTGentProcessInfo{}, false
	}
	var info localTGentProcessInfo
	if json.Unmarshal(data, &info) != nil {
		return localTGentProcessInfo{}, false
	}
	return info, true
}

func localTGentSocketCandidates() []string {
	candidates := make([]string, 0, 2)
	if info, ok := readLocalTGentProcessInfo(); ok && info.LocalSocket != "" {
		candidates = append(candidates, info.LocalSocket)
	}
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates, filepath.Join(home, ".tgent", "tgent.sock"))
	}
	return uniqueStrings(candidates)
}

func localTGentAccess(ctx context.Context) LocalTGentAccess {
	hostname, _ := os.Hostname()
	addresses := localTGentCandidates()
	access := LocalTGentAccess{Name: hostname}
	if len(addresses) > 0 {
		access.Address = addresses[0]
	}

	for _, socketPath := range localTGentSocketCandidates() {
		credentials, ok := credentialsFromLocalSocket(ctx, socketPath)
		if !ok {
			continue
		}
		access.Found = true
		access.SocketAvailable = true
		access.SocketPath = socketPath
		access.AuthEnabled = credentials.AuthEnabled
		access.WebPassword = credentials.Password
		access.PasswordAvailable = credentials.Password != ""
		access.AgentID = credentials.AgentID
		access.HubAddr = credentials.HubAddr
		if credentials.Name != "" {
			access.Name = credentials.Name
		}
		if address := loopbackAddress(credentials.Listen); address != "" {
			access.Address = address
		}
		return access
	}

	for _, passwordPath := range localTGentPasswordCandidates() {
		password, ok := readOwnerOnlySecret(passwordPath)
		if ok {
			access.AuthEnabled = password != ""
			access.WebPassword = password
			access.PasswordAvailable = password != ""
			break
		}
	}
	return access
}

func localTGentPasswordCandidates() []string {
	paths := make([]string, 0, 2)
	for _, socketPath := range localTGentSocketCandidates() {
		paths = append(paths, filepath.Join(filepath.Dir(socketPath), "password"))
	}
	if home, err := os.UserHomeDir(); err == nil {
		paths = append(paths, filepath.Join(home, ".tgent", "password"))
	}
	return uniqueStrings(paths)
}

func readOwnerOnlySecret(path string) (string, bool) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", false
	}
	// Windows does not expose ACL ownership through Unix permission bits.
	// The secret remains inside the current user's data directory there.
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		return "", false
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	return strings.TrimSpace(string(data)), true
}

type localSocketCredentials struct {
	AuthEnabled bool   `json:"authEnabled"`
	Password    string `json:"password"`
	Listen      string `json:"listen"`
	Name        string `json:"name"`
	AgentID     string `json:"agentId"`
	HubAddr     string `json:"hubAddr"`
}

func credentialsFromLocalSocket(ctx context.Context, socketPath string) (localSocketCredentials, bool) {
	if !isSecureLocalSocket(socketPath) {
		return localSocketCredentials{}, false
	}
	client, transport := localSocketHTTPClient(socketPath, localTGentProbeTimeout)
	defer transport.CloseIdleConnections()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://tgent.local/api/v1/local/credentials", nil)
	response, err := client.Do(request)
	if err != nil {
		return localSocketCredentials{}, false
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return localSocketCredentials{}, false
	}
	var credentials localSocketCredentials
	if json.NewDecoder(response.Body).Decode(&credentials) != nil {
		return localSocketCredentials{}, false
	}
	return credentials, true
}

func isSecureLocalSocket(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode()&os.ModeSocket != 0 && info.Mode().Perm()&0o077 == 0
}

func localSocketHTTPClient(socketPath string, timeout time.Duration) (*http.Client, *http.Transport) {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socketPath)
		},
	}
	return &http.Client{Transport: transport, Timeout: timeout}, transport
}

func loopbackAddress(listen string) string {
	listen = strings.TrimSpace(listen)
	if listen == "" {
		return ""
	}

	if strings.Contains(listen, "://") {
		parsed, err := url.Parse(listen)
		if err != nil {
			return ""
		}
		listen = parsed.Host
	}

	_, port, err := net.SplitHostPort(listen)
	if err != nil {
		return ""
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return ""
	}
	return "http://" + net.JoinHostPort("127.0.0.1", port)
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func probeLocalTGent(ctx context.Context, addresses []string, client *http.Client) localTGentProbeResult {
	results := make(chan localTGentProbeResult, len(addresses))
	for index, address := range addresses {
		go func() {
			result := localTGentProbeResult{index: index, address: address}
			request, err := http.NewRequestWithContext(ctx, http.MethodGet, address+"/api/v1/status", nil)
			if err != nil {
				results <- result
				return
			}
			response, err := client.Do(request)
			if err != nil {
				results <- result
				return
			}
			defer response.Body.Close()

			switch response.StatusCode {
			case http.StatusUnauthorized, http.StatusForbidden:
				result.found = true
				result.requiresPassword = true
			case http.StatusOK:
				var payload struct {
					Status string `json:"status"`
				}
				if json.NewDecoder(response.Body).Decode(&payload) == nil && payload.Status == "ok" {
					result.found = true
				}
			}
			results <- result
		}()
	}

	best := localTGentProbeResult{index: len(addresses)}
	for range addresses {
		select {
		case result := <-results:
			if result.found && result.index < best.index {
				best = result
			}
		case <-ctx.Done():
			return best
		}
	}
	return best
}
