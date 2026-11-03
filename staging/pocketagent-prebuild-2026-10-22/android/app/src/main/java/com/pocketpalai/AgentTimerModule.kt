package com.pocketpal

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager

/** Inexact elapsed-realtime alarm: survives app backgrounding and process death. */
class AgentTimerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Agent timers", NotificationManager.IMPORTANCE_DEFAULT))
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
        val pending = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.notify(ID, Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("PocketAgent timer finished")
            .setContentText("Your timer has elapsed")
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build())
    }
    companion object {
        const val ACTION = "com.pocketpal.AGENT_TIMER"
        const val CHANNEL = "pocketagent_timer"
        const val ID = 8830
    }
}

class AgentTimerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "AgentTimer"
    private fun pending(): PendingIntent {
        val intent = Intent(context, AgentTimerReceiver::class.java).setAction(AgentTimerReceiver.ACTION)
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    @ReactMethod fun schedule(seconds: Double, promise: Promise) {
        if (!seconds.isFinite() || seconds < 60.0 || seconds > 86400.0 || seconds != kotlin.math.floor(seconds)) {
            promise.reject("INVALID_TIMER", "Timer must be 60–86400 whole seconds"); return
        }
        try {
            val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val target = SystemClock.elapsedRealtime() + seconds.toLong() * 1000L
            alarm.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, target, pending())
            promise.resolve(target.toDouble())
        } catch (e: Exception) { promise.reject("TIMER_SCHEDULE", e) }
    }
    @ReactMethod fun cancel(promise: Promise) {
        try {
            (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending())
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("TIMER_CANCEL", e) }
    }
}
class AgentTimerPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(AgentTimerModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
