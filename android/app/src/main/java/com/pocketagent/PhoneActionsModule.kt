package com.pocketagent

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.MediaStore
import android.provider.Settings
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ViewManager

/**
 * Phone actions through Android's own intents, the same ones voice
 * assistants send. Only the actions below exist; each is built here with
 * correctly typed extras (React Native's Linking sends numbers as doubles,
 * which the Clock app ignores). Nothing here calls, sends, pays or changes a
 * setting by itself: calls, texts, e-mails and calendar events open pre-filled
 * and the user presses the button. The JS side asks for approval first.
 *
 * Every action answers {ok: true} or {ok: false, reason}, where reason is
 * "no_app" (nothing on this phone handles it), "bad_args" or "failed".
 */
class PhoneActionsModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
    override fun getName() = "PhoneActions"

    /** Settings pages a model may open (read-only screens; the user acts). */
    private val settingsPages = mapOf(
        "main" to Settings.ACTION_SETTINGS,
        "wifi" to Settings.ACTION_WIFI_SETTINGS,
        "bluetooth" to Settings.ACTION_BLUETOOTH_SETTINGS,
        "battery" to Intent.ACTION_POWER_USAGE_SUMMARY,
        "display" to Settings.ACTION_DISPLAY_SETTINGS,
        "sound" to Settings.ACTION_SOUND_SETTINGS,
        "location" to Settings.ACTION_LOCATION_SOURCE_SETTINGS,
        "apps" to Settings.ACTION_APPLICATION_SETTINGS,
        "notifications" to "android.settings.ALL_APPS_NOTIFICATION_SETTINGS",
        "airplane" to Settings.ACTION_AIRPLANE_MODE_SETTINGS,
    )

    private fun str(args: ReadableMap, key: String): String? =
        if (args.hasKey(key) && !args.isNull(key)) args.getString(key)?.trim()?.takeIf { it.isNotEmpty() } else null

    private fun int(args: ReadableMap, key: String): Int? =
        if (args.hasKey(key) && !args.isNull(key)) args.getDouble(key).toInt() else null

    private fun dbl(args: ReadableMap, key: String): Double? =
        if (args.hasKey(key) && !args.isNull(key)) args.getDouble(key) else null

    /** The intent for an action, or null when the arguments don't make one. */
    private fun build(action: String, args: ReadableMap): Intent? = when (action) {
        "set_timer" -> {
            val seconds = int(args, "seconds")
            if (seconds == null || seconds < 1 || seconds > 86400) null
            else Intent(AlarmClock.ACTION_SET_TIMER).apply {
                putExtra(AlarmClock.EXTRA_LENGTH, seconds)
                str(args, "label")?.let { putExtra(AlarmClock.EXTRA_MESSAGE, it) }
                putExtra(AlarmClock.EXTRA_SKIP_UI, args.hasKey("skipUi") && args.getBoolean("skipUi"))
            }
        }
        "show_timers" -> Intent(AlarmClock.ACTION_SHOW_TIMERS)
        "set_alarm" -> {
            val hour = int(args, "hour")
            val minutes = int(args, "minutes") ?: 0
            if (hour == null || hour !in 0..23 || minutes !in 0..59) null
            else Intent(AlarmClock.ACTION_SET_ALARM).apply {
                putExtra(AlarmClock.EXTRA_HOUR, hour)
                putExtra(AlarmClock.EXTRA_MINUTES, minutes)
                str(args, "label")?.let { putExtra(AlarmClock.EXTRA_MESSAGE, it) }
                if (args.hasKey("days") && !args.isNull("days")) {
                    // Calendar.SUNDAY = 1 … SATURDAY = 7.
                    val days = ArrayList<Int>()
                    val list = args.getArray("days")!!
                    for (i in 0 until list.size()) {
                        val d = list.getDouble(i).toInt()
                        if (d in 1..7) days.add(d)
                    }
                    if (days.isNotEmpty()) putIntegerArrayListExtra(AlarmClock.EXTRA_DAYS, days)
                }
                putExtra(AlarmClock.EXTRA_SKIP_UI, false)
            }
        }
        "show_alarms" -> Intent(AlarmClock.ACTION_SHOW_ALARMS)
        "open_app" -> str(args, "package")?.let {
            context.packageManager.getLaunchIntentForPackage(it)
        }
        "navigate" -> str(args, "destination")?.let {
            Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(it)))
        }
        "play_music" -> str(args, "query")?.let {
            Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).apply {
                putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*")
                putExtra(android.app.SearchManager.QUERY, it)
            }
        }
        "open_camera" -> Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)
        "open_settings" -> settingsPages[str(args, "page") ?: "main"]?.let { Intent(it) }
        "add_reminder" -> str(args, "title")?.let { title ->
            Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI).apply {
                putExtra(CalendarContract.Events.TITLE, title)
                str(args, "notes")?.let { putExtra(CalendarContract.Events.DESCRIPTION, it) }
                dbl(args, "startMs")?.let {
                    putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, it.toLong())
                    putExtra(CalendarContract.EXTRA_EVENT_END_TIME, it.toLong() + 30 * 60 * 1000)
                }
            }
        }
        // Pre-filled screens only: the user presses call / send.
        "dial" -> str(args, "number")?.let {
            Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(it, "+")))
        }
        "sms" -> Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(str(args, "number") ?: "", "+"))).apply {
            str(args, "body")?.let { putExtra("sms_body", it) }
        }
        "email" -> Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + Uri.encode(str(args, "to") ?: "", "@.+-_"))).apply {
            str(args, "subject")?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
            str(args, "body")?.let { putExtra(Intent.EXTRA_TEXT, it) }
        }
        else -> null
    }

    private fun result(ok: Boolean, reason: String? = null): WritableMap =
        Arguments.createMap().apply {
            putBoolean("ok", ok)
            reason?.let { putString("reason", it) }
        }

    /** Whether this phone has an app that handles the action. */
    @ReactMethod fun canPerform(action: String, args: ReadableMap, promise: Promise) {
        try {
            val intent = build(action, args)
            promise.resolve(intent != null && intent.resolveActivity(context.packageManager) != null)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod fun perform(action: String, args: ReadableMap, promise: Promise) {
        try {
            val intent = build(action, args)
            if (intent == null) {
                promise.resolve(result(false, "bad_args"))
                return
            }
            if (intent.resolveActivity(context.packageManager) == null) {
                promise.resolve(result(false, "no_app"))
                return
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            val activity = currentActivity
            if (activity != null) activity.startActivity(intent) else context.startActivity(intent)
            promise.resolve(result(true))
        } catch (e: Exception) {
            promise.resolve(result(false, "failed"))
        }
    }

    /** Launchable apps (label + package), for matching "open <app>". */
    @Suppress("DEPRECATION")
    @ReactMethod fun listApps(promise: Promise) {
        try {
            val pm = context.packageManager
            val main = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val apps = Arguments.createArray()
            val seen = HashSet<String>()
            for (info in pm.queryIntentActivities(main, 0)) {
                val pkg = info.activityInfo.packageName
                if (pkg == context.packageName || !seen.add(pkg)) continue
                apps.pushMap(Arguments.createMap().apply {
                    putString("label", info.loadLabel(pm).toString())
                    putString("package", pkg)
                })
            }
            promise.resolve(apps)
        } catch (e: Exception) {
            promise.reject("PHONE_ACTIONS", e)
        }
    }
}

class PhoneActionsPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(PhoneActionsModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
