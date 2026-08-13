//go:build darwin

package globalhotkey

/*
#cgo LDFLAGS: -framework Carbon
#include <Carbon/Carbon.h>
#include <stdint.h>
#include <stdlib.h>

extern void tgentHotkeyCallback(uintptr_t handle);

typedef struct {
	EventHandlerRef handler;
	EventHotKeyRef hotkey;
} TGentHotkeyRegistration;

static OSStatus tgentHandleHotkey(EventHandlerCallRef nextHandler, EventRef event, void *userData) {
	(void)nextHandler;
	(void)event;
	tgentHotkeyCallback((uintptr_t)userData);
	return noErr;
}

static TGentHotkeyRegistration* tgentRegisterHotkey(
	uintptr_t handle,
	uint32_t keyCode,
	uint32_t modifiers,
	uint32_t identifier,
	OSStatus *status
) {
	TGentHotkeyRegistration *registration = calloc(1, sizeof(TGentHotkeyRegistration));
	if (registration == NULL) {
		*status = memFullErr;
		return NULL;
	}

	EventTypeSpec eventType = { kEventClassKeyboard, kEventHotKeyPressed };
	*status = InstallApplicationEventHandler(
		NewEventHandlerUPP(tgentHandleHotkey),
		1,
		&eventType,
		(void*)handle,
		&registration->handler
	);
	if (*status != noErr) {
		free(registration);
		return NULL;
	}

	EventHotKeyID hotkeyID = { 0x54474E54, identifier };
	*status = RegisterEventHotKey(
		keyCode,
		modifiers,
		hotkeyID,
		GetApplicationEventTarget(),
		0,
		&registration->hotkey
	);
	if (*status != noErr) {
		RemoveEventHandler(registration->handler);
		free(registration);
		return NULL;
	}
	return registration;
}

static void tgentUnregisterHotkey(TGentHotkeyRegistration *registration) {
	if (registration == NULL) return;
	if (registration->hotkey != NULL) UnregisterEventHotKey(registration->hotkey);
	if (registration->handler != NULL) RemoveEventHandler(registration->handler);
	free(registration);
}
*/
import "C"

import (
	"fmt"
	"runtime/cgo"
	"sync"
	"sync/atomic"
	"time"
)

var nextHotkeyID atomic.Uint32

type Registration struct {
	onTriggered func()
	handle      cgo.Handle
	native      *C.TGentHotkeyRegistration
	once        sync.Once
	triggerMu   sync.Mutex
	lastTrigger time.Time
}

func Register(shortcut string, onTriggered func()) (*Registration, error) {
	chord, err := Parse(shortcut)
	if err != nil {
		return nil, err
	}
	registration := &Registration{onTriggered: onTriggered}
	registration.handle = cgo.NewHandle(registration)
	var status C.OSStatus
	registration.native = C.tgentRegisterHotkey(
		C.uintptr_t(registration.handle),
		C.uint32_t(carbonKeyCode(chord.Key)),
		C.uint32_t(carbonModifiers(chord)),
		C.uint32_t(nextHotkeyID.Add(1)),
		&status,
	)
	if registration.native == nil {
		registration.handle.Delete()
		return nil, fmt.Errorf("register Carbon hotkey: OSStatus %d", int(status))
	}
	return registration, nil
}

func carbonModifiers(chord Chord) uint32 {
	var modifiers uint32
	if chord.Mod {
		modifiers |= 1 << 8
	}
	if chord.Shift {
		modifiers |= 1 << 9
	}
	if chord.Alt {
		modifiers |= 1 << 11
	}
	if chord.Control {
		modifiers |= 1 << 12
	}
	return modifiers
}

func carbonKeyCode(key string) uint32 {
	keys := map[string]uint32{
		"A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6, "X": 7,
		"C": 8, "V": 9, "B": 11, "Q": 12, "W": 13, "E": 14, "R": 15, "Y": 16,
		"T": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25,
		"7": 26, "8": 28, "0": 29, "O": 31, "U": 32, "I": 34, "P": 35, "L": 37,
		"J": 38, "K": 40, "N": 45, "M": 46,
		"Enter": 36, "Tab": 48, "Space": 49, "`": 50, "Backspace": 51, "Escape": 53,
		"Comma": 43, "Period": 47,
		"F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97,
		"F7": 98, "F8": 100, "F9": 101, "F10": 109, "F11": 103, "F12": 111,
		"F13": 105, "F14": 107, "F15": 113, "F16": 106, "F17": 64, "F18": 79,
		"F19": 80, "F20": 90,
		"ArrowLeft": 123, "ArrowRight": 124, "ArrowDown": 125, "ArrowUp": 126,
	}
	return keys[key]
}

func (r *Registration) Close() {
	if r == nil {
		return
	}
	r.once.Do(func() {
		C.tgentUnregisterHotkey(r.native)
		r.native = nil
		r.handle.Delete()
	})
}

func (r *Registration) trigger() {
	r.triggerMu.Lock()
	now := time.Now()
	if now.Sub(r.lastTrigger) < 250*time.Millisecond {
		r.triggerMu.Unlock()
		return
	}
	r.lastTrigger = now
	r.triggerMu.Unlock()
	go r.onTriggered()
}

//export tgentHotkeyCallback
func tgentHotkeyCallback(handle C.uintptr_t) {
	registration := cgo.Handle(handle).Value().(*Registration)
	registration.trigger()
}
