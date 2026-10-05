package main

import (
	"syscall"
	"unsafe"
)

// message shows a Windows message box (the launcher is a GUI program without a console).
func message(title, text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	box := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	const mbOK, mbIconInfo = 0x0, 0x40
	_, _, _ = box.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbOK|mbIconInfo)
}
