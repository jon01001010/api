package com.pocketpal.localapi

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class LocalApiModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private var server: LoopbackServer? = null
    @Volatile private var generation = 0
    private val pending = ConcurrentHashMap<String, CompletableFuture<LoopbackServer.Reply>>()
    override fun getName() = "LocalApi"
    @ReactMethod fun addListener(name: String) {}
    @ReactMethod fun removeListeners(count: Double) {}
    private fun emit(name: String, payload: WritableMap) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, payload)
    }
    @Synchronized @ReactMethod fun start(promise: Promise) {
        if (server != null) { promise.reject("RUNNING", "Already running"); return }
        try {
            if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                promise.reject("NOTIFICATION_REQUIRED", "Allow notifications before sharing the model"); return
            }
            val currentGeneration = ++generation
            server = LoopbackServer(8765) { path, body ->
                if (generation != currentGeneration) return@LoopbackServer LoopbackServer.Reply(503, "{}")
                val id = UUID.randomUUID().toString()
                val future = CompletableFuture<LoopbackServer.Reply>()
                pending[id] = future
                try {
                    emit("localApiRequest", Arguments.createMap().apply {
                        putString("id", id); putString("path", path); putString("body", body)
                    })
                    future.get(120, TimeUnit.SECONDS)
                } catch (e: Exception) {
                    LoopbackServer.Reply(504, "{\"error\":{\"message\":\"Request expired\"}}")
                } finally {
                    pending.remove(id)
                    emit("localApiCancel", Arguments.createMap().apply { putString("id", id) })
                }
            }
            LocalApiService.onStop = { synchronized(this) { if (generation == currentGeneration) shutdown() } }
            val intent = Intent(context, LocalApiService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            promise.resolve(Arguments.createMap().apply {
                putString("url", "http://127.0.0.1:8765/v1"); putString("token", server!!.token())
            })
        } catch (e: Exception) { shutdown(); promise.reject("START_FAILED", "Local service could not start") }
    }
    @ReactMethod fun respond(id: String, status: Double, body: String) {
        if (body.length <= 262144) pending[id]?.complete(LoopbackServer.Reply(status.toInt(), body))
        else pending[id]?.complete(LoopbackServer.Reply(500, "{\"error\":{\"message\":\"Response too large\"}}"))
    }
    @ReactMethod fun stop(promise: Promise) { shutdown(); promise.resolve(true) }
    @Synchronized private fun shutdown() {
        generation++
        server?.close(); server = null
        pending.values.forEach { it.cancel(true) }; pending.clear()
        LocalApiService.onStop = null
        context.stopService(Intent(context, LocalApiService::class.java))
        emit("localApiStopped", Arguments.createMap())
    }
    override fun invalidate() { shutdown(); super.invalidate() }
}

class LocalApiPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(LocalApiModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
