//go:build darwin

package screenbounds

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

typedef struct {
	int ok;
	int x;
	int y;
	int width;
	int height;
} TGentScreenBounds;

static TGentScreenBounds tgentScreenUnderCursor(void) {
	__block TGentScreenBounds result = {0, 0, 0, 0, 0};
	void (^readBounds)(void) = ^{
		@autoreleasepool {
			NSArray<NSScreen *> *screens = [NSScreen screens];
			if ([screens count] == 0) return;

			NSPoint cursor = [NSEvent mouseLocation];
			NSRect primaryFrame = [[screens objectAtIndex:0] frame];
			for (NSScreen *screen in screens) {
				NSRect frame = [screen frame];
				if (!NSMouseInRect(cursor, frame, NO)) continue;
				result.ok = 1;
				result.x = (int)frame.origin.x;
				result.y = (int)(NSMaxY(primaryFrame) - NSMaxY(frame));
				result.width = (int)frame.size.width;
				result.height = (int)frame.size.height;
				break;
			}
		}
	};
	if ([NSThread isMainThread]) readBounds();
	else dispatch_sync(dispatch_get_main_queue(), readBounds);
	return result;
}
*/
import "C"

func UnderCursor() (Bounds, bool) {
	bounds := C.tgentScreenUnderCursor()
	if bounds.ok == 0 || bounds.width <= 0 || bounds.height <= 0 {
		return Bounds{}, false
	}
	return Bounds{
		X:      int(bounds.x),
		Y:      int(bounds.y),
		Width:  int(bounds.width),
		Height: int(bounds.height),
	}, true
}
