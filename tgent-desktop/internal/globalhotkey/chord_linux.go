//go:build linux && cgo

package globalhotkey

import (
	"strconv"
	"strings"

	"golang.design/x/hotkey"
)

func nativeChord(chord Chord) ([]hotkey.Modifier, hotkey.Key) {
	modifiers := make([]hotkey.Modifier, 0, 3)
	if chord.Mod || chord.Control {
		modifiers = append(modifiers, hotkey.ModCtrl)
	}
	if chord.Alt {
		modifiers = append(modifiers, hotkey.Mod1)
	}
	if chord.Shift {
		modifiers = append(modifiers, hotkey.ModShift)
	}

	keys := map[string]hotkey.Key{
		"`": 0x0060, "Space": 0x0020, "Comma": 0x002C, "Period": 0x002E,
		"Escape": 0xFF1B, "Enter": 0xFF0D, "Backspace": 0xFF08, "Tab": 0xFF09,
		"ArrowLeft": 0xFF51, "ArrowUp": 0xFF52, "ArrowRight": 0xFF53, "ArrowDown": 0xFF54,
	}
	if key, ok := keys[chord.Key]; ok {
		return modifiers, key
	}
	if len(chord.Key) == 1 {
		return modifiers, hotkey.Key(strings.ToLower(chord.Key)[0])
	}
	number, _ := strconv.Atoi(chord.Key[1:])
	return modifiers, hotkey.Key(0xFFBE + number - 1)
}
