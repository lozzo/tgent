package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestReadClipboardImage(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "clipboard.png")
	want := []byte{0x89, 0x50, 0x4e, 0x47}
	if err := os.WriteFile(path, want, 0o600); err != nil {
		t.Fatal(err)
	}

	image, err := readClipboardImage(path)
	if err != nil {
		t.Fatal(err)
	}
	if image.LocalPath != path || image.Name != "clipboard.png" || image.Size != int64(len(want)) {
		t.Fatalf("unexpected image metadata: %+v", image)
	}
	if image.Data != base64.StdEncoding.EncodeToString(want) {
		t.Fatalf("image data = %q", image.Data)
	}
}

func TestTerminalClipboardJSONShape(t *testing.T) {
	clipboard := TerminalClipboard{Kind: "text", Text: "https://example.com/path"}
	data, err := json.Marshal(clipboard)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"kind":"text","text":"https://example.com/path","image":{"localPath":"","name":"","size":0,"data":""}}` {
		t.Fatalf("unexpected clipboard JSON: %s", data)
	}
}
