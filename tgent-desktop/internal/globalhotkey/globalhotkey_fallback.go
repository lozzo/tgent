//go:build !darwin && !windows && (!linux || !cgo)

package globalhotkey

import "errors"

type Registration struct{}

func Register(shortcut string, _ func()) (*Registration, error) {
	if _, err := Parse(shortcut); err != nil {
		return nil, err
	}
	return nil, errors.New("global hotkeys require a supported desktop session")
}

func (r *Registration) Close() {}
