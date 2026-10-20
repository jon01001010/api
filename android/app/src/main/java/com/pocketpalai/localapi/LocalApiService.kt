package com.pocketpal.localapi

import android.app.*
import android.content.Intent
import android.os.Build
import android.os.IBinder

/** User-started only; never restart inference after process death. */
class LocalApiService : Service() {
    companion object { @Volatile var onStop: (() -> Unit)? = null }
    private var stopSession: (() -> Unit)? = null
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate()
        stopSession = onStop
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel("local_ai", "Local AI service", NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(this, 1, Intent(this, LocalApiService::class.java).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE)
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "local_ai") else Notification.Builder(this)
        startForeground(8765, builder.setContentTitle("API Helper is sharing its local model")
            .setContentText("Only apps with your session key can connect")
            .setSmallIcon(android.R.drawable.ic_dialog_info).setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Stop", stop).build()).build())
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP" || onStop == null) { stopSession?.invoke(); stopSelf() }
        else { stopSession = onStop }
        return START_NOT_STICKY
    }
    override fun onDestroy() { stopSession?.invoke(); super.onDestroy() }
}
