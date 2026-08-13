package globalhotkey

import (
	"fmt"
	"strconv"
	"strings"
)

const DefaultShortcut = "Control+`"

// Chord is the platform-independent representation persisted by the desktop UI.
type Chord struct {
	Mod     bool
	Control bool
	Alt     bool
	Shift   bool
	Key     string
}

func Parse(shortcut string) (Chord, error) {
	var chord Chord
	parts := strings.Split(strings.TrimSpace(shortcut), "+")
	if len(parts) == 0 || strings.TrimSpace(parts[len(parts)-1]) == "" {
		return chord, errorsForShortcut(shortcut, "missing key")
	}

	for _, rawModifier := range parts[:len(parts)-1] {
		modifier := strings.TrimSpace(rawModifier)
		switch modifier {
		case "Mod":
			if chord.Mod {
				return chord, errorsForShortcut(shortcut, "duplicate Mod modifier")
			}
			chord.Mod = true
		case "Control":
			if chord.Control {
				return chord, errorsForShortcut(shortcut, "duplicate Control modifier")
			}
			chord.Control = true
		case "Alt":
			if chord.Alt {
				return chord, errorsForShortcut(shortcut, "duplicate Alt modifier")
			}
			chord.Alt = true
		case "Shift":
			if chord.Shift {
				return chord, errorsForShortcut(shortcut, "duplicate Shift modifier")
			}
			chord.Shift = true
		default:
			return chord, errorsForShortcut(shortcut, fmt.Sprintf("unknown modifier %q", modifier))
		}
	}

	key, ok := normalizeKey(strings.TrimSpace(parts[len(parts)-1]))
	if !ok {
		return chord, errorsForShortcut(shortcut, "unsupported key")
	}
	chord.Key = key
	if !chord.Mod && !chord.Control && !chord.Alt && !isFunctionKey(key) {
		return chord, errorsForShortcut(shortcut, "add Command, Control, Alt, or use a function key")
	}
	return chord, nil
}

func Normalize(shortcut string) (string, error) {
	chord, err := Parse(shortcut)
	if err != nil {
		return "", err
	}
	return chord.String(), nil
}

func (c Chord) String() string {
	parts := make([]string, 0, 5)
	if c.Mod {
		parts = append(parts, "Mod")
	}
	if c.Control {
		parts = append(parts, "Control")
	}
	if c.Alt {
		parts = append(parts, "Alt")
	}
	if c.Shift {
		parts = append(parts, "Shift")
	}
	return strings.Join(append(parts, c.Key), "+")
}

func normalizeKey(key string) (string, bool) {
	switch key {
	case "`", "Space", "Comma", "Period", "Escape", "Enter", "Backspace", "Tab",
		"ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight":
		return key, true
	}
	upper := strings.ToUpper(key)
	if len(upper) == 1 && ((upper[0] >= 'A' && upper[0] <= 'Z') || (upper[0] >= '0' && upper[0] <= '9')) {
		return upper, true
	}
	if isFunctionKey(upper) {
		return upper, true
	}
	return "", false
}

func isFunctionKey(key string) bool {
	if len(key) < 2 || key[0] != 'F' {
		return false
	}
	number, err := strconv.Atoi(key[1:])
	return err == nil && number >= 1 && number <= 20
}

func errorsForShortcut(shortcut, detail string) error {
	return fmt.Errorf("invalid global shortcut %q: %s", shortcut, detail)
}
