package com.pocketpal

import android.content.Intent
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.os.Build
import com.facebook.react.bridge.*
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager

class BackgroundInferenceModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "BackgroundInference"
    override fun initialize() {
        super.initialize()
        BackgroundInferenceService.reactContext = context
    }
    override fun invalidate() {
        if (BackgroundInferenceService.reactContext === context) BackgroundInferenceService.reactContext = null
        super.invalidate()
    }
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
    @ReactMethod fun start(promise: Promise) {
        try {
            val intent = Intent(context, BackgroundInferenceService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("INFERENCE_SERVICE", e) }
    }
    @ReactMethod fun finish(completedInBackground: Boolean, promise: Promise) {
        try {
            context.stopService(Intent(context, BackgroundInferenceService::class.java))
            if (completedInBackground && Build.VERSION.SDK_INT >= 26) {
                val manager = context.getSystemService(NotificationManager::class.java)
                val channel = "pocketagent_completed"
                manager.createNotificationChannel(NotificationChannel(channel, "Completed AI responses", NotificationManager.IMPORTANCE_DEFAULT))
                val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent(context, MainActivity::class.java)
                val pending = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                val notification = Notification.Builder(context, channel)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("PocketAgent response complete")
                    .setContentText("Tap to read Qwen’s response")
                    .setContentIntent(pending)
                    .setAutoCancel(true)
                    .build()
                manager.notify(8822, notification)
            }
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("INFERENCE_SERVICE", e) }
    }
}
class BackgroundInferencePackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(BackgroundInferenceModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
