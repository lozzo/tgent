package com.tgent.app

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * NativeFilePickerPlugin — 使用 Android SAF (ACTION_OPEN_DOCUMENT) 选择文件
 *
 * 返回 content:// URI，供 Native FileTransferManager 直接读取上传。
 */
@CapacitorPlugin(name = "NativeFilePicker")
class NativeFilePickerPlugin : Plugin() {

    companion object {
        private const val TAG = "NativeFilePicker"
    }

    @PluginMethod
    fun pickFiles(call: PluginCall) {
        val multiple = call.getBoolean("multiple", false) ?: false

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            if (multiple) {
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
        }

        startActivityForResult(call, intent, "pickFilesResult")
    }

    @ActivityCallback
    private fun pickFilesResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            // User cancelled
            val ret = JSObject()
            ret.put("files", JSArray())
            call.resolve(ret)
            return
        }

        val data = result.data
        val uris = mutableListOf<Uri>()

        if (data != null) {
            val clipData = data.clipData
            if (clipData != null) {
                for (i in 0 until clipData.itemCount) {
                    clipData.getItemAt(i).uri?.let { uris.add(it) }
                }
            } else {
                data.data?.let { uris.add(it) }
            }
        }

        val files = JSArray()
        for (uri in uris) {
            val file = queryFileInfo(uri)
            if (file != null) {
                files.put(file)
            }
        }

        val ret = JSObject()
        ret.put("files", files)
        call.resolve(ret)
    }

    private fun queryFileInfo(uri: Uri): JSObject? {
        var name = "unknown"
        var size = 0L
        var mimeType = "application/octet-stream"

        try {
            // Query display name and size
            val cursor: Cursor? = context.contentResolver.query(uri, null, null, null, null)
            cursor?.use {
                if (it.moveToFirst()) {
                    val nameIdx = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIdx >= 0) {
                        name = it.getString(nameIdx) ?: name
                    }
                    val sizeIdx = it.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIdx >= 0) {
                        size = it.getLong(sizeIdx)
                    }
                }
            }

            // Get mime type
            context.contentResolver.getType(uri)?.let { mimeType = it }
        } catch (e: Exception) {
            Log.e(TAG, "queryFileInfo error for $uri", e)
        }

        return JSObject().apply {
            put("uri", uri.toString())
            put("name", name)
            put("size", size)
            put("mimeType", mimeType)
        }
    }
}
