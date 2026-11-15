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
    /** Pictures take minutes: their own thread, so chats and status go on meanwhile. */
    private val pictureWorker = Executors.newSingleThreadExecutor()
    /** PC tools may wait on a question on the PC: their own thread too. */
    private val toolWorker = Executors.newSingleThreadExecutor()
    @Volatile private var ready = false

    override fun getName() = "HomeLink"

    private fun keyFile(): String =
        File(File(context.noBackupFilesDir, "homelink"), "phone.key").absolutePath

    /** Runs a library call off the main thread; resolves with its JSON. */
    private fun call(
        promise: Promise,
        executor: java.util.concurrent.Executor = worker,
        block: () -> String
    ) {
        if (!HomeLinkNative.loaded) {
            promise.resolve("{\"ok\":false,\"error\":\"The home link is not in this build\"}")
            return
        }
        executor.execute {
            try {
                synchronized(this) {
                    if (!ready) {
                        // The app's context (not an activity), kept for the app's life.
                        HomeLinkNative.init(context.applicationContext)
                        ready = true
                    }
                }
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
    fun startModel(pc: String, promise: Promise) =
        call(promise) { HomeLinkNative.startModel(keyFile(), pc) }

    @ReactMethod
    fun sync(pc: String, body: String, promise: Promise) =
        call(promise) { HomeLinkNative.sync(keyFile(), pc, body) }

    @ReactMethod
    fun questions(pc: String, promise: Promise) =
        call(promise) { HomeLinkNative.questions(keyFile(), pc) }

    /** Yes or no to one of the PC's questions (never "always"). */
    @ReactMethod
    fun answerQuestion(pc: String, id: Double, yes: Boolean, promise: Promise) =
        call(promise) { HomeLinkNative.answerQuestion(keyFile(), pc, id.toLong(), yes) }

    /**
     * Asks the PC for a picture (only while allowed on the PC for this
     * phone). Saved in the app's own picture folder (its cache folder, the
     * one the chat reads pictures from), under a name made here.
     */
    @ReactMethod
    fun picture(pc: String, prompt: String, width: Double, height: Double, steps: Double, promise: Promise) =
        call(promise, pictureWorker) {
            val dir = File(context.cacheDir, "pc-pictures")
            dir.mkdirs()
            val stamp = java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.US)
                .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
                .format(java.util.Date())
            val tag = String.format("%04x", java.security.SecureRandom().nextInt(0x10000))
            val out = File(dir, "picture-$stamp-$tag.png").absolutePath
            HomeLinkNative.picture(
                keyFile(), pc, prompt, width.toInt(), height.toInt(), steps.toInt(), out
            )
        }

    /**
     * One of the PC's read-only tools (only while allowed on the PC for
     * this phone; reading its workspace asks there once per chat, so this
     * may wait minutes: its own thread, so chats and status go on).
     */
    @ReactMethod
    fun tool(pc: String, name: String, chat: String, args: String, promise: Promise) =
        call(promise, toolWorker) { HomeLinkNative.tool(keyFile(), pc, name, chat, args) }

    @ReactMethod
    fun openTunnel(pc: String, promise: Promise) =
        call(promise) { HomeLinkNative.openTunnel(keyFile(), pc) }

    @ReactMethod
    fun closeTunnel(promise: Promise) = call(promise) { HomeLinkNative.closeTunnel() }
}
