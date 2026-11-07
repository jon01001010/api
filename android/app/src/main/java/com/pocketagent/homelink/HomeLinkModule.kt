package com.pocketagent.homelink

import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.util.concurrent.Executors

/**
 * Home link, phone side: use the home PC's model from anywhere (the PC side
 * is DesktopAgent; SECURITY.md rule 5). Pairing starts from the PC's QR code
 * and the PC asks its user. The tunnel listens on 127.0.0.1 only.
 *
 * The phone's own key lives in the app's no-backup folder: private to the
 * app and never copied into a cloud backup.
 */
class HomeLinkModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
    private val worker = Executors.newSingleThreadExecutor()

    override fun getName() = "HomeLink"

    private fun keyFile(): String =
        File(File(context.noBackupFilesDir, "homelink"), "phone.key").absolutePath

    /** Runs a library call off the main thread; resolves with its JSON. */
    private fun call(promise: Promise, block: () -> String) {
        if (!HomeLinkNative.loaded) {
            promise.resolve("{\"ok\":false,\"error\":\"The home link is not in this build\"}")
            return
        }
        worker.execute {
            try {
                promise.resolve(block())
            } catch (e: Throwable) {
                promise.resolve("{\"ok\":false,\"error\":\"${e.javaClass.simpleName}\"}")
            }
        }
    }

    @ReactMethod
    fun pair(qr: String, promise: Promise) {
        val name = (Build.MODEL ?: "Phone").take(40)
        call(promise) { HomeLinkNative.pair(keyFile(), qr, name) }
    }

    @ReactMethod
    fun status(pc: String, promise: Promise) =
        call(promise) { HomeLinkNative.status(keyFile(), pc) }

    @ReactMethod
    fun openTunnel(pc: String, promise: Promise) =
        call(promise) { HomeLinkNative.openTunnel(keyFile(), pc) }

    @ReactMethod
    fun closeTunnel(promise: Promise) = call(promise) { HomeLinkNative.closeTunnel() }
}
