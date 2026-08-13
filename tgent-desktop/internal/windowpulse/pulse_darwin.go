//go:build darwin

package windowpulse

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

static NSWindow *tgentActiveWindow(void) {
	NSWindow *window = [NSApp keyWindow];
	if (window == nil) window = [NSApp mainWindow];
	if (window != nil) return window;
	for (NSWindow *candidate in [NSApp windows]) {
		if ([candidate isVisible]) return candidate;
	}
	return nil;
}

static void tgentInvalidateViewTree(NSView *view) {
	if (view == nil) return;
	[view setNeedsLayout:YES];
	[view setNeedsDisplay:YES];
	for (NSView *child in [view subviews]) {
		tgentInvalidateViewTree(child);
	}
}

static void tgentPulseTerminalSurface(void) {
	dispatch_async(dispatch_get_main_queue(), ^{
		@autoreleasepool {
			NSWindow *window = tgentActiveWindow();
			NSView *contentView = [window contentView];
			if (contentView == nil) return;
			tgentInvalidateViewTree(contentView);
			[contentView layoutSubtreeIfNeeded];
			[contentView displayIfNeeded];
			[window displayIfNeeded];
		}
	});
}
*/
import "C"

// Pulse invalidates the WKWebView hierarchy without changing window geometry.
func Pulse() {
	C.tgentPulseTerminalSurface()
}
