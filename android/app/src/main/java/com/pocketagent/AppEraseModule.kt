package com.pocketagent

import android.app.ActivityManager
import android.content.Context
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

    companion object {
        /** Only the app's own folders and its own Keystore keys. */
        fun eraseByHand(context: Context) {
            try {
                val keys = KeyStore.getInstance("AndroidKeyStore")
                keys.load(null)
                for (alias in keys.aliases().toList()) {
                    try { keys.deleteEntry(alias) } catch (_: Exception) {}
                }
            } catch (_: Exception) {}
            val roots = mutableListOf<File?>(context.dataDir)
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
