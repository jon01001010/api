package com.pocketagent.homelink

/**
 * The home link library (native/homelink, built with the Android tools into
 * libhomelink.so). Every call answers with JSON and waits on the network, so
 * call it off the main thread (HomeLinkModule does).
 */
object HomeLinkNative {
    /** False when this build has no libhomelink.so. */
    val loaded: Boolean = try {
        System.loadLibrary("homelink")
        true
    } catch (e: Throwable) {
        false
    }

    /** Once, before anything else: the app's context, which iroh needs on Android. */
    @JvmStatic external fun init(context: android.content.Context): String
    @JvmStatic external fun pair(keyFile: String, qr: String, name: String): String
    @JvmStatic external fun status(keyFile: String, pc: String): String
    @JvmStatic external fun startModel(keyFile: String, pc: String): String
    @JvmStatic external fun sync(keyFile: String, pc: String, body: String): String
    @JvmStatic external fun questions(keyFile: String, pc: String): String
    @JvmStatic external fun answerQuestion(keyFile: String, pc: String, id: Long, yes: Boolean): String
    /** A picture made on the PC, written to outFile (sizes and steps 0: the PC's default). */
    @JvmStatic external fun picture(
        keyFile: String, pc: String, prompt: String,
        width: Int, height: Int, steps: Int, outFile: String
    ): String
    /** One of the PC's read-only tools (args: JSON; only a file's name is sent on). */
    @JvmStatic external fun tool(
        keyFile: String, pc: String, name: String, chat: String, args: String
    ): String
    /**
     * Device circle (stage 2): "remove" (a signed removal notice waits to be
     * passed on) or "news" (removals applied here). JSON in and out; no network.
     */
    @JvmStatic external fun circle(keyFile: String, request: String): String
    @JvmStatic external fun openTunnel(keyFile: String, pc: String): String
    @JvmStatic external fun closeTunnel(): String
}
