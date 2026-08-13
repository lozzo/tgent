package com.tgent.app;

import android.view.HapticFeedbackConstants;
import android.view.View;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeHaptic")
public class NativeHapticPlugin extends Plugin {

    @PluginMethod()
    public void impact(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            View view = getBridge().getWebView();
            if (view != null) {
                view.performHapticFeedback(
                    HapticFeedbackConstants.KEYBOARD_TAP,
                    HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING
                );
            }
            call.resolve();
        });
    }
}
