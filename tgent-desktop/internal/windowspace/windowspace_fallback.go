//go:build !darwin && !windows

package windowspace

func Prepare() bool                     { return false }
func Present() bool                     { return false }
func Hide() bool                        { return false }
func SetBounds(int, int, int, int) bool { return false }
func Height() (int, int, bool)          { return 0, 0, false }
func Restore()                          {}
