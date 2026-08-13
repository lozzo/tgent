//go:build windows

package windowspace

import (
	"os"
	"runtime"
	"sync"
	"syscall"
	"unsafe"
)

const (
	clsctxInprocServer  = 1
	coinitMultithreaded = 0
	gwOwner             = 4
)

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

type virtualDesktopManager struct {
	VTable *virtualDesktopManagerVTable
}

type virtualDesktopManagerVTable struct {
	QueryInterface                  uintptr
	AddRef                          uintptr
	Release                         uintptr
	IsWindowOnCurrentVirtualDesktop uintptr
	GetWindowDesktopID              uintptr
	MoveWindowToDesktop             uintptr
}

var (
	user32 = syscall.NewLazyDLL("user32.dll")
	ole32  = syscall.NewLazyDLL("ole32.dll")

	enumWindows              = user32.NewProc("EnumWindows")
	getForegroundWindow      = user32.NewProc("GetForegroundWindow")
	getWindow                = user32.NewProc("GetWindow")
	getWindowThreadProcessID = user32.NewProc("GetWindowThreadProcessId")
	coInitializeEx           = ole32.NewProc("CoInitializeEx")
	coUninitialize           = ole32.NewProc("CoUninitialize")
	coCreateInstance         = ole32.NewProc("CoCreateInstance")

	virtualDesktopManagerClassID = guid{0xAA509086, 0x5CA9, 0x4C25, [8]byte{0x8F, 0x95, 0x58, 0x9D, 0x3C, 0x07, 0xB4, 0x8A}}
	virtualDesktopManagerIID     = guid{0xA5CD92FF, 0x29BE, 0x454C, [8]byte{0x8D, 0x04, 0xD8, 0x28, 0x79, 0xFB, 0x3F, 0x1B}}

	windowLookupMu     sync.Mutex
	windowLookupPID    uint32
	windowLookupHWND   uintptr
	enumWindowCallback = syscall.NewCallback(findProcessWindow)
)

// Prepare moves the reused Wails window to the virtual desktop containing the
// foreground window before Wails makes it visible.
func Prepare() bool {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	foreground, _, _ := getForegroundWindow.Call()
	if foreground == 0 {
		return false
	}
	target := currentProcessWindow()
	if target == 0 || target == foreground {
		return false
	}

	result, _, _ := coInitializeEx.Call(0, coinitMultithreaded)
	if hresultFailed(result) {
		return false
	}
	defer coUninitialize.Call()

	var manager *virtualDesktopManager
	result, _, _ = coCreateInstance.Call(
		uintptr(unsafe.Pointer(&virtualDesktopManagerClassID)),
		0,
		clsctxInprocServer,
		uintptr(unsafe.Pointer(&virtualDesktopManagerIID)),
		uintptr(unsafe.Pointer(&manager)),
	)
	if hresultFailed(result) || manager == nil {
		return false
	}
	defer syscall.SyscallN(manager.VTable.Release, uintptr(unsafe.Pointer(manager)))

	var desktopID guid
	result, _, _ = syscall.SyscallN(
		manager.VTable.GetWindowDesktopID,
		uintptr(unsafe.Pointer(manager)),
		foreground,
		uintptr(unsafe.Pointer(&desktopID)),
	)
	if hresultFailed(result) {
		return false
	}
	syscall.SyscallN(
		manager.VTable.MoveWindowToDesktop,
		uintptr(unsafe.Pointer(manager)),
		target,
		uintptr(unsafe.Pointer(&desktopID)),
	)
	return false
}

func Present() bool                     { return false }
func Hide() bool                        { return false }
func SetBounds(int, int, int, int) bool { return false }
func Height() (int, int, bool)          { return 0, 0, false }
func Restore()                          {}

func currentProcessWindow() uintptr {
	windowLookupMu.Lock()
	defer windowLookupMu.Unlock()
	windowLookupPID = uint32(os.Getpid())
	windowLookupHWND = 0
	enumWindows.Call(enumWindowCallback, 0)
	return windowLookupHWND
}

func findProcessWindow(hwnd uintptr, _ uintptr) uintptr {
	var processID uint32
	getWindowThreadProcessID.Call(hwnd, uintptr(unsafe.Pointer(&processID)))
	if processID != windowLookupPID {
		return 1
	}
	owner, _, _ := getWindow.Call(hwnd, gwOwner)
	if owner != 0 {
		return 1
	}
	windowLookupHWND = hwnd
	return 0
}

func hresultFailed(result uintptr) bool {
	return int32(result) < 0
}
