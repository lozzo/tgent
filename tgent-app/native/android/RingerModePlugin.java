package com.tgent.app;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RingerMode")
public class RingerModePlugin extends Plugin {

    @PluginMethod()
    public void getRingerMode(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        int mode = am.getRingerMode();
        JSObject ret = new JSObject();
        // RINGER_MODE_SILENT = 0, RINGER_MODE_VIBRATE = 1, RINGER_MODE_NORMAL = 2
        ret.put("mode", mode);
        ret.put("silent", mode == AudioManager.RINGER_MODE_SILENT);
        call.resolve(ret);
    }
}
