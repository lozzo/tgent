//go:build darwin

package clipboardimage

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#include <stdlib.h>
#include <string.h>

static int tgentWriteClipboardPNG(const char *destination) {
	@autoreleasepool {
		NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
		// Never ask NSImage to interpret the complete pasteboard. URL and file-URL
		// pasteboard items may otherwise be resolved as image resources while a
		// terminal paste is in progress. Only decode explicit in-memory image data.
		NSArray<NSPasteboardType> *imageTypes = @[
			NSPasteboardTypePNG,
			NSPasteboardTypeTIFF,
			@"public.jpeg",
			@"public.heic"
		];
		NSPasteboardType imageType = [pasteboard availableTypeFromArray:imageTypes];
		if (imageType == nil) return 0;
		NSData *source = [pasteboard dataForType:imageType];
		if (source == nil || source.length == 0) return 0;

		NSBitmapImageRep *bitmap = [NSBitmapImageRep imageRepWithData:source];
		NSData *png = bitmap == nil ? nil : [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
		NSString *path = [NSString stringWithUTF8String:destination];
		BOOL written = png != nil && path != nil && [png writeToFile:path atomically:YES];
		return written ? 1 : -1;
	}
}

static char *tgentReadClipboardText(void) {
	@autoreleasepool {
		NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
		NSString *text = [pasteboard stringForType:NSPasteboardTypeString];
		if (text == nil) text = [pasteboard stringForType:NSPasteboardTypeURL];
		if (text == nil) return NULL;
		const char *utf8 = [text UTF8String];
		return utf8 == NULL ? NULL : strdup(utf8);
	}
}
*/
import "C"

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
	"unsafe"
)

func Save() (string, error) {
	dir := filepath.Join(os.TempDir(), "tgent-clipboard-images")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("create clipboard image directory: %w", err)
	}
	removeExpired(dir)

	file, err := os.CreateTemp(dir, "clipboard-*.png")
	if err != nil {
		return "", fmt.Errorf("reserve clipboard image path: %w", err)
	}
	path := file.Name()
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	_ = os.Remove(path)

	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))
	result := int(C.tgentWriteClipboardPNG(cPath))
	if result == 0 {
		return "", nil
	}
	if result < 0 {
		return "", fmt.Errorf("encode clipboard image as PNG")
	}
	if err := os.Chmod(path, 0o600); err != nil {
		_ = os.Remove(path)
		return "", fmt.Errorf("secure clipboard image: %w", err)
	}
	return path, nil
}

func ReadText() string {
	text := C.tgentReadClipboardText()
	if text == nil {
		return ""
	}
	defer C.free(unsafe.Pointer(text))
	return C.GoString(text)
}

func removeExpired(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-24 * time.Hour)
	for _, entry := range entries {
		info, err := entry.Info()
		if err == nil && !entry.IsDir() && info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(dir, entry.Name()))
		}
	}
}
