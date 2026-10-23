package com.pocketpal

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.os.Bundle
import androidx.core.content.ContextCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager

/** Push-to-talk speech recognition; no background microphone or wake word. */
class VoiceInputModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private var recognizer: SpeechRecognizer? = null
    private var pending: Promise? = null
    override fun getName() = "PocketAgentVoiceInput"

    @ReactMethod fun listen(promise: Promise) {
        context.runOnUiQueueThread {
            if (pending != null) { promise.reject("BUSY", "Recognition already active"); return@runOnUiQueueThread }
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                promise.reject("MIC_PERMISSION", "Microphone permission not granted"); return@runOnUiQueueThread
            }
            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                promise.reject("UNAVAILABLE", "Speech recognition is not available"); return@runOnUiQueueThread
            }
            try {
                val engine = SpeechRecognizer.createSpeechRecognizer(context)
                recognizer = engine
                pending = promise
                engine.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {}
                    override fun onBeginningOfSpeech() {}
                    override fun onRmsChanged(rmsdB: Float) {}
                    override fun onBufferReceived(buffer: ByteArray?) {}
                    override fun onEndOfSpeech() {}
                    override fun onPartialResults(partialResults: Bundle?) {}
                    override fun onEvent(eventType: Int, params: Bundle?) {}
                    override fun onError(error: Int) { settle(null, "Recognition error: $error") }
                    override fun onResults(results: Bundle?) {
                        val words = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                        settle(words ?: "", null)
                    }
                })
                engine.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                })
            } catch (e: Exception) { settle(null, e.message ?: "Speech input failed") }
        }
    }
    private fun settle(value: String?, error: String?) {
        val callback = pending ?: return
        pending = null
        recognizer?.destroy()
        recognizer = null
        if (error != null) callback.reject("SPEECH_ERROR", error) else callback.resolve(value)
    }
    @ReactMethod fun cancel(promise: Promise) {
        context.runOnUiQueueThread {
            if (pending != null) settle(null, "Cancelled")
            promise.resolve(true)
        }
    }
    override fun invalidate() {
        context.runOnUiQueueThread { if (pending != null) settle(null, "App closed") }
        super.invalidate()
    }
}
class VoiceInputPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(VoiceInputModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
