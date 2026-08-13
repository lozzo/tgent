//go:build windows || (linux && cgo)

package globalhotkey

import (
	"sync"
	"time"

	"golang.design/x/hotkey"
)

type Registration struct {
	hotkey *hotkey.Hotkey
	stop   chan struct{}
	done   chan struct{}
	once   sync.Once
}

func Register(shortcut string, onTriggered func()) (*Registration, error) {
	chord, err := Parse(shortcut)
	if err != nil {
		return nil, err
	}
	modifiers, key := nativeChord(chord)
	hk := hotkey.New(modifiers, key)
	if err := hk.Register(); err != nil {
		return nil, err
	}

	registration := &Registration{
		hotkey: hk,
		stop:   make(chan struct{}),
		done:   make(chan struct{}),
	}
	go registration.listen(onTriggered)
	return registration, nil
}

func (r *Registration) Close() {
	if r == nil {
		return
	}
	r.once.Do(func() {
		close(r.stop)
		_ = r.hotkey.Unregister()
		<-r.done
	})
}

func (r *Registration) listen(onTriggered func()) {
	defer close(r.done)
	var lastTrigger time.Time
	for {
		select {
		case _, ok := <-r.hotkey.Keydown():
			if !ok {
				return
			}
			now := time.Now()
			if now.Sub(lastTrigger) >= 250*time.Millisecond {
				lastTrigger = now
				onTriggered()
			}
		case <-r.stop:
			return
		}
	}
}
