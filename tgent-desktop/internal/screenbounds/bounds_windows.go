//go:build windows

package screenbounds

import (
	"syscall"
	"unsafe"
)

const monitorDefaultToNearest = 2

type point struct {
	X int32
	Y int32
}

type rect struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

type monitorInfo struct {
	Size    uint32
	Monitor rect
	Work    rect
	Flags   uint32
}

var (
	user32           = syscall.NewLazyDLL("user32.dll")
	getCursorPos     = user32.NewProc("GetCursorPos")
	monitorFromPoint = user32.NewProc("MonitorFromPoint")
	getMonitorInfo   = user32.NewProc("GetMonitorInfoW")
)

func UnderCursor() (Bounds, bool) {
	var cursor point
	if ok, _, _ := getCursorPos.Call(uintptr(unsafe.Pointer(&cursor))); ok == 0 {
		return Bounds{}, false
	}
	packedPoint := uintptr(uint32(cursor.X)) | uintptr(uint64(uint32(cursor.Y))<<32)
	monitor, _, _ := monitorFromPoint.Call(packedPoint, monitorDefaultToNearest)
	if monitor == 0 {
		return Bounds{}, false
	}
	info := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	if ok, _, _ := getMonitorInfo.Call(monitor, uintptr(unsafe.Pointer(&info))); ok == 0 {
		return Bounds{}, false
	}
	return Bounds{
		X:      int(info.Monitor.Left),
		Y:      int(info.Monitor.Top),
		Width:  int(info.Monitor.Right - info.Monitor.Left),
		Height: int(info.Monitor.Bottom - info.Monitor.Top),
	}, true
}
