package com.pocketpal

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder

/** Keeps a user-started inference session foreground-visible; inference itself stays in llama.rn. */
class BackgroundInferenceService : Service() {
    companion object {
        const val ACTION_FINISH = "com.pocketpal.INFERENCE_FINISH"
        const val ACTION_CANCEL = "com.pocketpal.INFERENCE_CANCEL"
        const val CHANNEL = "pocketagent_inference"
        const val ID = 8821
        @Volatile var onCancel: (() -> Unit)? = null
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Background AI responses", NotificationManager.IMPORTANCE_LOW))
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_FINISH) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_CANCEL) {
            onCancel?.invoke()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pending = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val cancel = PendingIntent.getService(this, 1, Intent(this, BackgroundInferenceService::class.java).setAction(ACTION_CANCEL), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("PocketAgent is generating")
            .setContentText("Tap to return to your chat")
            .setContentIntent(pending)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Stop", cancel).build())
            .build()
        startForeground(ID, notification)
        return START_NOT_STICKY
    }
}
