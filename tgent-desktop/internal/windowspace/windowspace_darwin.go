//go:build darwin

package windowspace

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa -framework WebKit
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

static BOOL tgentInvokeAppMethod(NSString *method);

@interface TGentQuakePanel : NSPanel
@end

@implementation TGentQuakePanel
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return YES; }
- (BOOL)hidesOnDeactivate { return NO; }
- (void)performClose:(id)sender {
	if (!tgentInvokeAppMethod(@"HideQuake")) [self orderOut:nil];
}
@end

static NSWindow *tgentNormalWindow = nil;
static TGentQuakePanel *tgentQuakePanel = nil;
static NSResponder *tgentHostedFirstResponder = nil;
static BOOL tgentPanelPrepared = NO;
static unsigned long long tgentPanelGeneration = 0;
static id tgentApplicationActivationObserver = nil;
static BOOL tgentAppMethodPending = NO;

static void tgentOnMainThreadSync(void (^operation)(void)) {
	if ([NSThread isMainThread]) operation();
	else dispatch_sync(dispatch_get_main_queue(), operation);
}

static NSWindow *tgentFindNormalWindow(void) {
	if (tgentNormalWindow != nil) return tgentNormalWindow;
	NSWindow *window = [NSApp keyWindow];
	if (window == nil) window = [NSApp mainWindow];
	if (window != nil && ![window isKindOfClass:[NSPanel class]]) return window;
	for (NSWindow *candidate in [NSApp windows]) {
		if (![candidate isKindOfClass:[NSPanel class]] && [candidate contentView] != nil) return candidate;
	}
	return nil;
}

static WKWebView *tgentFindWebView(NSView *view) {
	if (view == nil) return nil;
	if ([view isKindOfClass:[WKWebView class]]) return (WKWebView *)view;
	for (NSView *child in [view subviews]) {
		WKWebView *webView = tgentFindWebView(child);
		if (webView != nil) return webView;
	}
	return nil;
}

static BOOL tgentInvokeAppMethod(NSString *method) {
	if (!tgentPanelPrepared || tgentQuakePanel == nil || tgentAppMethodPending) return NO;
	WKWebView *webView = tgentFindWebView([tgentQuakePanel contentView]);
	if (webView == nil) return NO;
	tgentAppMethodPending = YES;
	NSString *script = [NSString stringWithFormat:
		@"window.go && window.go.main && window.go.main.App && window.go.main.App.%@ && window.go.main.App.%@().catch(function(){})",
		method, method];
	[webView evaluateJavaScript:script completionHandler:^(__unused id value, __unused NSError *error) {
		tgentAppMethodPending = NO;
	}];
	return YES;
}

static BOOL tgentHandleApplicationReopen(__unused id delegate, __unused SEL selector,
	__unused NSApplication *application, __unused BOOL hasVisibleWindows) {
	tgentInvokeAppMethod(@"ShowNormal");
	return YES;
}

static void tgentInstallApplicationActivationHooks(void) {
	if (tgentApplicationActivationObserver != nil) return;
	id delegate = [NSApp delegate];
	if (delegate != nil) {
		class_addMethod([delegate class],
			@selector(applicationShouldHandleReopen:hasVisibleWindows:),
			(IMP)tgentHandleApplicationReopen,
			"c@:@c");
	}
	tgentApplicationActivationObserver = [[NSNotificationCenter defaultCenter]
		addObserverForName:NSApplicationDidBecomeActiveNotification
		object:NSApp
		queue:[NSOperationQueue mainQueue]
		usingBlock:^(__unused NSNotification *notification) {
			if (tgentPanelPrepared && tgentQuakePanel != nil && ![tgentQuakePanel isVisible]) {
				tgentInvokeAppMethod(@"ShowNormal");
			}
		}];
}

static NSWindowCollectionBehavior tgentPanelBehavior(void) {
	return (NSWindowCollectionBehaviorCanJoinAllSpaces |
		NSWindowCollectionBehaviorFullScreenAuxiliary |
		NSWindowCollectionBehaviorIgnoresCycle);
}

static void tgentConfigurePanel(TGentQuakePanel *panel, NSWindow *normalWindow) {
	[panel setTitle:[normalWindow title]];
	[panel setTitleVisibility:[normalWindow titleVisibility]];
	[panel setTitlebarAppearsTransparent:[normalWindow titlebarAppearsTransparent]];
	[panel setAppearance:[normalWindow appearance]];
	[panel setBackgroundColor:[normalWindow backgroundColor]];
	[panel setOpaque:[normalWindow isOpaque]];
	[panel setHasShadow:[normalWindow hasShadow]];
	[panel setMovable:YES];
	[panel setMovableByWindowBackground:[normalWindow isMovableByWindowBackground]];
	[panel setReleasedWhenClosed:NO];
	[panel setHidesOnDeactivate:NO];
	[panel setFloatingPanel:YES];
	[panel setBecomesKeyOnlyIfNeeded:NO];
	[panel setCollectionBehavior:tgentPanelBehavior()];
	[panel setLevel:NSMainMenuWindowLevel - 2];
	[panel setMinSize:NSMakeSize(1, 1)];
	[panel setMaxSize:NSMakeSize(CGFLOAT_MAX, CGFLOAT_MAX)];
}

static TGentQuakePanel *tgentCreatePanel(NSWindow *normalWindow) {
	NSWindowStyleMask style = [normalWindow styleMask];
	style &= ~NSWindowStyleMaskFullScreen;
	style |= NSWindowStyleMaskNonactivatingPanel;
	NSRect contentRect = [normalWindow contentRectForFrameRect:[normalWindow frame]];
	TGentQuakePanel *panel = [[TGentQuakePanel alloc]
		initWithContentRect:contentRect
		styleMask:style
		backing:NSBackingStoreBuffered
		defer:NO];
	tgentConfigurePanel(panel, normalWindow);
	return panel;
}

static BOOL tgentPrepareQuakePanel(void) {
	__block BOOL prepared = NO;
	tgentOnMainThreadSync(^{
		@autoreleasepool {
			tgentInstallApplicationActivationHooks();
			if (tgentPanelPrepared && tgentQuakePanel != nil && [tgentQuakePanel contentView] != nil) {
				tgentPanelGeneration++;
				prepared = YES;
				return;
			}

			NSWindow *normalWindow = tgentFindNormalWindow();
			NSView *contentView = [normalWindow contentView];
			if (normalWindow == nil || contentView == nil) return;
			tgentNormalWindow = normalWindow;
			if (tgentQuakePanel == nil) {
				tgentQuakePanel = tgentCreatePanel(normalWindow);
			} else {
				tgentConfigurePanel(tgentQuakePanel, normalWindow);
			}

			tgentHostedFirstResponder = [normalWindow firstResponder];
			[contentView retain];
			[normalWindow orderOut:nil];
			[normalWindow setContentView:nil];
			[tgentQuakePanel setContentView:contentView];
			[contentView release];
			[tgentQuakePanel setFrame:[normalWindow frame] display:NO];
			tgentPanelPrepared = YES;
			tgentPanelGeneration++;
			prepared = YES;
		}
	});
	return prepared;
}

static BOOL tgentSetQuakePanelBounds(int x, int y, int width, int height) {
	__block BOOL handled = NO;
	tgentOnMainThreadSync(^{
		@autoreleasepool {
			if (!tgentPanelPrepared || tgentQuakePanel == nil || width <= 0 || height <= 0) return;
			NSArray<NSScreen *> *screens = [NSScreen screens];
			if ([screens count] == 0) return;
			NSRect primaryFrame = [[screens objectAtIndex:0] frame];
			NSRect frame = NSMakeRect(
				(CGFloat)x,
				NSMaxY(primaryFrame) - (CGFloat)y - (CGFloat)height,
				(CGFloat)width,
				(CGFloat)height);
			[tgentQuakePanel setFrame:frame display:YES];
			handled = YES;
		}
	});
	return handled;
}

typedef struct {
	int ok;
	int height;
	int screenHeight;
} TGentQuakePanelSize;

static TGentQuakePanelSize tgentGetQuakePanelSize(void) {
	__block TGentQuakePanelSize result = {0, 0, 0};
	tgentOnMainThreadSync(^{
		@autoreleasepool {
			if (!tgentPanelPrepared || tgentQuakePanel == nil) return;
			NSScreen *screen = [tgentQuakePanel screen];
			if (screen == nil) return;
			NSRect panelFrame = [tgentQuakePanel frame];
			NSRect screenFrame = [screen frame];
			if (panelFrame.size.height <= 0 || screenFrame.size.height <= 0) return;
			result.ok = 1;
			result.height = (int)panelFrame.size.height;
			result.screenHeight = (int)screenFrame.size.height;
		}
	});
	return result;
}

static BOOL tgentPresentQuakePanel(void) {
	__block BOOL handled = NO;
	tgentOnMainThreadSync(^{
		@autoreleasepool {
			if (!tgentPanelPrepared || tgentQuakePanel == nil) return;
			[tgentQuakePanel setCollectionBehavior:tgentPanelBehavior()];
			[tgentQuakePanel setLevel:NSMainMenuWindowLevel - 2];

			NSRunningApplication *frontmost = [[NSWorkspace sharedWorkspace] frontmostApplication];
			BOOL appIsInBackground = (frontmost != nil &&
				![frontmost isEqual:[NSRunningApplication currentApplication]]);
			[tgentQuakePanel setAlphaValue:appIsInBackground ? 0 : 1];
			[tgentQuakePanel makeKeyAndOrderFront:nil];
			if (tgentHostedFirstResponder != nil) {
				[tgentQuakePanel makeFirstResponder:tgentHostedFirstResponder];
			}

			unsigned long long generation = ++tgentPanelGeneration;
			if (appIsInBackground) {
				dispatch_async(dispatch_get_main_queue(), ^{
					if (generation != tgentPanelGeneration || !tgentPanelPrepared || tgentQuakePanel == nil) return;
					[tgentQuakePanel setAlphaValue:1];
					[tgentQuakePanel displayIfNeeded];
				});
			}
			handled = YES;
		}
	});
	return handled;
}

static BOOL tgentHideQuakePanel(void) {
	__block BOOL handled = NO;
	tgentOnMainThreadSync(^{
		@autoreleasepool {
			if (!tgentPanelPrepared || tgentQuakePanel == nil) return;
			tgentPanelGeneration++;
			[tgentQuakePanel orderOut:nil];
			[tgentQuakePanel setAlphaValue:1];
			handled = YES;
		}
	});
	return handled;
}

static void tgentRestoreNormalWindow(void) {
	tgentOnMainThreadSync(^{
		@autoreleasepool {
			tgentPanelGeneration++;
			if (!tgentPanelPrepared || tgentQuakePanel == nil || tgentNormalWindow == nil) return;

			NSView *contentView = [tgentQuakePanel contentView];
			if (contentView != nil) {
				[contentView retain];
				[tgentQuakePanel orderOut:nil];
				[tgentQuakePanel setContentView:nil];
				[tgentNormalWindow setContentView:contentView];
				[contentView release];
			}
			if (tgentHostedFirstResponder != nil) {
				[tgentNormalWindow makeFirstResponder:tgentHostedFirstResponder];
			}
			tgentHostedFirstResponder = nil;
			tgentPanelPrepared = NO;
		}
	});
}
*/
import "C"

func Prepare() bool { return bool(C.tgentPrepareQuakePanel()) }
func Present() bool { return bool(C.tgentPresentQuakePanel()) }
func Hide() bool    { return bool(C.tgentHideQuakePanel()) }
func SetBounds(x, y, width, height int) bool {
	return bool(C.tgentSetQuakePanelBounds(C.int(x), C.int(y), C.int(width), C.int(height)))
}
func Height() (int, int, bool) {
	size := C.tgentGetQuakePanelSize()
	return int(size.height), int(size.screenHeight), size.ok != 0
}
func Restore() { C.tgentRestoreNormalWindow() }
