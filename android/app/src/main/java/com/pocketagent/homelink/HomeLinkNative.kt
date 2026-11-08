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
    @JvmStatic external fun openTunnel(keyFile: String, pc: String): String
    @JvmStatic external fun closeTunnel(): String
}
