package com.pocketagent

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File

/**
 * Why the app closed last time (Android 11+ keeps the reasons), a file for
 * fatal JS errors written the moment they happen, and memory figures that
 * include Android's low-memory threshold.
 */
class AppDiagnosticsModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
    override fun getName() = "AppDiagnostics"

    private val jsErrorFile: File
        get() = File(context.filesDir, "last-js-error.txt")

    /** Printable text from a trace (tombstones are binary on Android 12+). */
    private fun readableTrace(bytes: ByteArray, limit: Int = 12000): String {
        val text = String(bytes, Charsets.ISO_8859_1)
        if (text.count { it == '\u0000' } < 10) {
            return text.take(limit)
        }
        val runs = Regex("[\\x20-\\x7e]{6,}").findAll(text).map { it.value }
        return runs.joinToString("\n").take(limit)
    }

    @ReactMethod
    fun getLastExits(max: Int, promise: Promise) {
        val list = Arguments.createArray()
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                val am = context.getSystemService(ActivityManager::class.java)
                val infos = am.getHistoricalProcessExitReasons(context.packageName, 0, max)
                for (info in infos) {
                    val map = Arguments.createMap()
                    map.putInt("reason", info.reason)
                    map.putString("description", info.description ?: "")
                    map.putDouble("timestamp", info.timestamp.toDouble())
                    map.putInt("status", info.status)
                    map.putInt("importance", info.importance)
                    map.putDouble("pssKb", info.pss.toDouble())
                    map.putDouble("rssKb", info.rss.toDouble())
                    val wantsTrace = info.reason == ApplicationExitInfo.REASON_ANR ||
                        info.reason == ApplicationExitInfo.REASON_CRASH_NATIVE
                    if (wantsTrace) {
                        try {
                            info.traceInputStream?.use { stream ->
                                map.putString("trace", readableTrace(stream.readBytes()))
                            }
                        } catch (_: Exception) {
                        }
                    }
                    list.pushMap(map)
                }
            }
            promise.resolve(list)
        } catch (e: Exception) {
            promise.reject("DIAGNOSTICS", e)
        }
    }

    @ReactMethod
    fun memoryInfo(promise: Promise) {
        try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val info = ActivityManager.MemoryInfo()
            am.getMemoryInfo(info)
            val map = Arguments.createMap()
            map.putDouble("availMem", info.availMem.toDouble())
            map.putDouble("threshold", info.threshold.toDouble())
            map.putDouble("totalMem", info.totalMem.toDouble())
            map.putBoolean("lowMemory", info.lowMemory)
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("DIAGNOSTICS", e)
        }
    }

    /** Synchronous so it finishes before a fatal error closes the app. */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun recordJsError(text: String): Boolean {
        return try {
            jsErrorFile.writeText("${System.currentTimeMillis()}\n$text")
            true
        } catch (_: Exception) {
            false
        }
    }

    @ReactMethod
    fun readJsError(promise: Promise) {
        try {
            promise.resolve(if (jsErrorFile.exists()) jsErrorFile.readText() else null)
        } catch (e: Exception) {
            promise.resolve(null)
        }
    }
}

class AppDiagnosticsPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(AppDiagnosticsModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
