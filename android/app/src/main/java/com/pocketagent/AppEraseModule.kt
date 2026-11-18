package com.pocketagent

import android.app.Activity
import android.app.ActivityManager
import android.app.NotificationManager
import android.app.job.JobScheduler
import android.content.Context
import android.os.Build
import android.view.WindowManager
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.security.KeyStore

/**
 * The erase PIN (src/services/appLock): erases everything PocketAgent keeps
 * on this phone, at once, without asking, then the app is stopped. Opened
 * again, it starts as new.
 *
 * ActivityManager.clearApplicationUserData() is the same as "Clear storage"
 * in Android's settings: the app's private data (files, databases, shared
 * preferences, no-backup folder, caches) and its area on shared storage,
 * its Android Keystore keys (PackageManagerService.clearApplicationUserDataLIF
 * calls clearKeystoreData), its runtime permissions, notifications, alarms
 * and jobs; the package is frozen and its process killed. No permission is
 * needed to clear one's own data. If it is refused, the same is done here
 * by hand and the process ends.
 *
 * Nothing outside the app's own folders is touched, and nothing is sent.
 *
 * Also here (security review 2, 2026-11-18): while the app PIN is on, the
 * window is secure (FLAG_SECURE, and on Android 13+ no recents screenshot):
 * the recent-apps preview shows nothing of the chats, and screenshots and
 * screen recording show a blank window. No permission is needed.
 */
class AppEraseModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "AppErase"

    @ReactMethod fun eraseAll(promise: Promise) {
        val started = try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            am.clearApplicationUserData()
        } catch (e: Exception) {
            false
        }
        if (started) {
            // The system stops the app shortly; nothing else to do.
            promise.resolve(true)
            return
        }
        try {
            eraseByHand(context)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
            return
        }
        android.os.Process.killProcess(android.os.Process.myPid())
    }

    /**
     * While the app PIN is on (appLock.ts): no recents preview, no
     * screenshots. Remembered, so the next start is secure from its first
     * frame (MainActivity.onCreate).
     */
    @ReactMethod fun setSecureWindow(on: Boolean, promise: Promise) {
        try {
            context.getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(KEY_SECURE, on).apply()
        } catch (_: Exception) {}
        val activity = context.currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }
        activity.runOnUiThread {
            try {
                applySecure(activity, on)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }
    }

    companion object {
        private const val SECURE_PREFS = "pocketagent_secure_window"
        private const val KEY_SECURE = "on"

        /** FLAG_SECURE on or off; on Android 13+ also the recents screenshot. */
        fun applySecure(activity: Activity, on: Boolean) {
            if (on) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
            if (Build.VERSION.SDK_INT >= 33) {
                activity.setRecentsScreenshotEnabled(!on)
            }
        }

        /** At start: as last set (MainActivity.onCreate). */
        fun applySavedSecure(activity: Activity) {
            try {
                val on = activity.getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)
                    .getBoolean(KEY_SECURE, false)
                if (on) applySecure(activity, true)
            } catch (_: Exception) {}
        }

        /** Only the app's own folders and its own Keystore keys. */
        fun eraseByHand(context: Context) {
            // Its own alarms, notifications and jobs first (the alarm list
            // is in its own files, removed below).
            try { LoopAlarmsModule.cancelAll(context) } catch (_: Exception) {}
            try {
                context.getSystemService(NotificationManager::class.java)?.cancelAll()
            } catch (_: Exception) {}
            try {
                context.getSystemService(JobScheduler::class.java)?.cancelAll()
            } catch (_: Exception) {}
            try {
                val keys = KeyStore.getInstance("AndroidKeyStore")
                keys.load(null)
                for (alias in keys.aliases().toList()) {
                    try { keys.deleteEntry(alias) } catch (_: Exception) {}
                }
            } catch (_: Exception) {}
            val roots = mutableListOf<File?>(context.dataDir)
            // Device-protected storage (/data/user_de/…/<package>): kept
            // apart from the credential-protected folder above.
            try {
                roots.add(context.createDeviceProtectedStorageContext().dataDir)
            } catch (_: Exception) {}
            roots.addAll(context.getExternalFilesDirs(null).map { it?.parentFile })
            roots.addAll(context.externalCacheDirs.map { it?.parentFile })
            for (root in roots.filterNotNull().distinct()) {
                // Each root is this app's own folder (…/<package>).
                if (root.name != context.packageName) continue
                root.listFiles()?.forEach { child ->
                    // lib is the installed app's own code, not data.
                    if (child.name != "lib") child.deleteRecursively()
                }
            }
        }
    }
}

class AppErasePackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(AppEraseModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
