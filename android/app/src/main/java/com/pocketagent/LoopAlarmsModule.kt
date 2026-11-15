package com.pocketagent

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.ViewManager

/**
 * Ready-made loops (src/services/loops/loopNotify.ts): a notification when a
 * loop is due, even with the app closed. Inexact alarms (AlarmManager.set…,
 * no exact-alarm permission): may be a few minutes late. The notification
 * only opens the app, which then asks Run now / Later / Skip; nothing runs
 * from here. Alarms are lost when the phone restarts; the app sets them
 * again the next time it opens (no boot permission).
 */
class LoopAlarmsModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
    override fun getName() = "LoopAlarms"

    companion object {
        const val CHANNEL = "pocketagent_loops"
        const val EXTRA_ID = "pocketagentLoopId"
        const val EXTRA_TITLE = "pocketagentLoopTitle"
        const val EXTRA_OPEN = "pocketagentOpenLoop"
        private const val PREFS = "pocketagent_loop_alarms"
        private const val KEY_IDS = "ids"

        /** MainActivity is on screen: the open app asks by itself. */
        @Volatile var appVisible = false
        /** The loop whose notification opened the app (taken once by JS). */
        @Volatile private var opened: String? = null

        fun noteOpened(intent: Intent?) {
            if (intent == null) return
            val id = intent.getStringExtra(EXTRA_OPEN) ?: return
            intent.removeExtra(EXTRA_OPEN)
            opened = id.take(64)
        }

        fun notifyId(id: String) = 8900 + (id.hashCode() and 0xffff)

        fun alarmIntent(context: Context, id: String, title: String): PendingIntent {
            val intent = Intent(context, LoopAlarmReceiver::class.java)
                .setData(Uri.fromParts("pocketagent-loop", id, null))
                .putExtra(EXTRA_ID, id)
                .putExtra(EXTRA_TITLE, title)
            return PendingIntent.getBroadcast(context, id.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }

    /** Replaces every loop alarm with these: [{id, title, at}]. */
    @ReactMethod fun schedule(list: ReadableArray, promise: Promise) {
        try {
            val alarms = context.getSystemService(AlarmManager::class.java)
            val manager = context.getSystemService(NotificationManager::class.java)
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            for (id in prefs.getStringSet(KEY_IDS, emptySet()) ?: emptySet()) {
                val pending = alarmIntent(context, id, "")
                alarms.cancel(pending)
                pending.cancel()
                manager.cancel(notifyId(id))
            }
            val ids = mutableSetOf<String>()
            for (i in 0 until minOf(list.size(), 20)) {
                val item = list.getMap(i) ?: continue
                val id = item.getString("id") ?: continue
                val title = (item.getString("title") ?: "Loop").take(80)
                val at = item.getDouble("at").toLong()
                if (id.isEmpty() || id.length > 64) continue
                val pending = alarmIntent(context, id, title)
                // Inexact (minSdk 24): Android may hold it a few minutes.
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
                ids.add(id)
            }
            prefs.edit().putStringSet(KEY_IDS, ids).apply()
            promise.resolve(ids.size)
        } catch (e: Exception) { promise.reject("LOOP_ALARMS", e) }
    }

    /** The loop whose notification opened the app, once; else null. */
    @ReactMethod fun takeOpened(promise: Promise) {
        val id = opened
        opened = null
        promise.resolve(id)
    }
}

/** A loop is due: a notification that opens the app (unless it's on screen). */
class LoopAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(LoopAlarmsModule.EXTRA_ID) ?: return
        if (LoopAlarmsModule.appVisible) return
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val title = intent.getStringExtra(LoopAlarmsModule.EXTRA_TITLE) ?: "Loop"
        try {
            val manager = context.getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26) {
                manager.createNotificationChannel(NotificationChannel(LoopAlarmsModule.CHANNEL, "Loops due", NotificationManager.IMPORTANCE_DEFAULT))
            }
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent(context, MainActivity::class.java)
            launch.putExtra(LoopAlarmsModule.EXTRA_OPEN, id)
            val pending = PendingIntent.getActivity(context, id.hashCode(), launch,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, LoopAlarmsModule.CHANNEL)
                else @Suppress("DEPRECATION") Notification.Builder(context)
            val notification = builder
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Loop due: $title")
                .setContentText("Tap to choose: Run now, Later or Skip")
                .setContentIntent(pending)
                .setAutoCancel(true)
                .build()
            manager.notify(LoopAlarmsModule.notifyId(id), notification)
        } catch (_: Exception) {
            // No notification; the app still asks when it is opened.
        }
    }
}

class LoopAlarmsPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(LoopAlarmsModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
