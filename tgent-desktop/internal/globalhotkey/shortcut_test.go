package globalhotkey

import "testing"

func TestNormalizeShortcut(t *testing.T) {
	tests := map[string]string{
		"Control+`":   "Control+`",
		"Mod+Shift+k": "Mod+Shift+K",
		"F12":         "F12",
		"Alt+1":       "Alt+1",
	}
	for input, want := range tests {
		got, err := Normalize(input)
		if err != nil {
			t.Fatalf("Normalize(%q): %v", input, err)
		}
		if got != want {
			t.Fatalf("Normalize(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestRejectsUnsafeOrUnsupportedShortcuts(t *testing.T) {
	for _, shortcut := range []string{"K", "Shift+K", "Control+", "Hyper+K", "Control+Delete"} {
		if _, err := Normalize(shortcut); err == nil {
			t.Fatalf("Normalize(%q) unexpectedly succeeded", shortcut)
		}
	}
}
