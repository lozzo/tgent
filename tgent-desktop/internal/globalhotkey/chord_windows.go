//go:build windows

package globalhotkey

import (
	"strconv"

	"golang.design/x/hotkey"
)

func nativeChord(chord Chord) ([]hotkey.Modifier, hotkey.Key) {
	modifiers := make([]hotkey.Modifier, 0, 3)
	if chord.Mod || chord.Control {
		modifiers = append(modifiers, hotkey.ModCtrl)
	}
	if chord.Alt {
		modifiers = append(modifiers, hotkey.ModAlt)
	}
	if chord.Shift {
		modifiers = append(modifiers, hotkey.ModShift)
	}

	keys := map[string]hotkey.Key{
		"`": 0xC0, "Space": 0x20, "Comma": 0xBC, "Period": 0xBE,
		"Escape": 0x1B, "Enter": 0x0D, "Backspace": 0x08, "Tab": 0x09,
		"ArrowLeft": 0x25, "ArrowUp": 0x26, "ArrowRight": 0x27, "ArrowDown": 0x28,
	}
	if key, ok := keys[chord.Key]; ok {
		return modifiers, key
	}
	if len(chord.Key) == 1 {
		return modifiers, hotkey.Key(chord.Key[0])
	}
	number, _ := strconv.Atoi(chord.Key[1:])
	return modifiers, hotkey.Key(0x70 + number - 1)
}
