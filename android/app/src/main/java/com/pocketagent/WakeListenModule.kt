package com.pocketagent

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/** Starts and stops WakeListenService. Start only while the app is visible. */
class WakeListenModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "WakeListen"

    override fun initialize() {
        super.initialize()
        WakeListenService.reactContext = context
    }

    override fun invalidate() {
        if (WakeListenService.reactContext === context) WakeListenService.reactContext = null
        super.invalidate()
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    @ReactMethod fun start(phrase: String, promise: Promise) {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            promise.reject("WAKE_SERVICE", "microphone permission not granted")
            return
        }
        try {
            val intent = Intent(context, WakeListenService::class.java)
                .putExtra(WakeListenService.EXTRA_PHRASE, phrase)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
            else context.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("WAKE_SERVICE", e)
        }
    }

    @ReactMethod fun stop(promise: Promise) {
        try {
            context.stopService(Intent(context, WakeListenService::class.java))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("WAKE_SERVICE", e)
        }
    }
}

class WakeListenPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(WakeListenModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
