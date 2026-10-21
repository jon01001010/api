package com.pocketpal

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.*
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager

class BackgroundInferenceModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "BackgroundInference"
    @ReactMethod fun start(promise: Promise) {
        try {
            val intent = Intent(context, BackgroundInferenceService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("INFERENCE_SERVICE", e) }
    }
    @ReactMethod fun finish(promise: Promise) {
        try {
            context.stopService(Intent(context, BackgroundInferenceService::class.java))
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("INFERENCE_SERVICE", e) }
    }
}
class BackgroundInferencePackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(BackgroundInferenceModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
