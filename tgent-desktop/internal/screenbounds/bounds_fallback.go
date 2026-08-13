//go:build !darwin && !windows

package screenbounds

func UnderCursor() (Bounds, bool) {
	return Bounds{}, false
}
