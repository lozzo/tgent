package clientcore

import (
	"bytes"
	"testing"
)

func TestBridgeFrameRoundTrip(t *testing.T) {
	want := bridgeFrame{typ: FrameData, channelID: 0x1234, payload: []byte("hello")}
	got, err := decodeFrame(encodeFrame(want.typ, want.channelID, want.payload))
	if err != nil {
		t.Fatal(err)
	}
	if got.typ != want.typ || got.channelID != want.channelID || !bytes.Equal(got.payload, want.payload) {
		t.Fatalf("round trip mismatch: %#v", got)
	}
}

func TestBridgeFrameRejectsLengthMismatch(t *testing.T) {
	frame := encodeFrame(FrameData, 1, []byte("hello"))
	frame = frame[:len(frame)-1]
	if _, err := decodeFrame(frame); err == nil {
		t.Fatal("expected length error")
	}
}

func TestParseLabel(t *testing.T) {
	tests := map[string][2]string{"api:hub:a": {"hub:a", "api"}, "events:local:b": {"local:b", "events"}, "terminal:hub:a:%42": {"hub:a", "terminal:%42"}, "file:local:b:id": {"local:b", "file:id"}}
	for input, want := range tests {
		key, label := parseLabel(input)
		if key != want[0] || label != want[1] {
			t.Errorf("parseLabel(%q)=(%q,%q)", input, key, label)
		}
	}
}
