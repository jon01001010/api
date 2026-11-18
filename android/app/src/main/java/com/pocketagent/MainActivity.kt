package com.pocketagent

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.uimanager.DisplayMetricsHolder
import androidx.core.view.WindowCompat   // for edge-to-edge pre API 35
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "PocketAgent"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
      // Prevent react-native-screens from restoring fragments after process death
      // This fixes the "Screen fragments should never be restored" crash
      // See: https://github.com/software-mansion/react-native-screens/issues/17
      // and https://github.com/software-mansion/react-native-screens?tab=readme-ov-file#android
      super.onCreate(null)

      fixExternalDisplayDensity()

      WindowCompat.enableEdgeToEdge(window)  // enable E2E pre-Android 15
      // App PIN on: no recents preview or screenshots from the first frame.
      AppEraseModule.applySavedSecure(this)
      noteAssist(intent)
      LoopAlarmsModule.noteOpened(intent)
    // Optional: fully transparent nav bar (can reduce contrast on 3-button nav)
    // window.isNavigationBarContrastEnforced = false
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
      super.onConfigurationChanged(newConfig)
      fixExternalDisplayDensity()
  }

  /**
   * Forward warm-launch deep-link intents to React Native. Under
   * launchMode="singleTask" the OS reuses this activity instance, so without
   * setIntent(intent) RN's Linking 'url' event never fires for the hub/run
   * deep link.
   */
  override fun onNewIntent(intent: Intent) {
      super.onNewIntent(intent)
      setIntent(intent)
      noteAssist(intent)
      LoopAlarmsModule.noteOpened(intent)
  }

  /** A due loop's notification shows only while the app is off screen. */
  override fun onResume() {
      super.onResume()
      LoopAlarmsModule.appVisible = true
  }

  override fun onPause() {
      LoopAlarmsModule.appVisible = false
      super.onPause()
  }

  /**
   * Opened as the phone's assistant: JS starts listening (PhoneActionsModule).
   * This screen is exported, so any app could send ACTION_ASSIST: only when
   * the system opened it (systemOpened) does a spoken message send by
   * itself; otherwise listening opens and the words wait in the box until
   * the user sends them (security review 2026-11-17).
   */
  private fun noteAssist(intent: Intent?) {
      val action = intent?.action ?: return
      if (action == Intent.ACTION_ASSIST || action == Intent.ACTION_VOICE_COMMAND) {
          PhoneActionsModule.onAssistLaunch(systemOpened(intent))
      }
  }

  /**
   * Whether the system opened this (long-press power, a corner swipe): the
   * launching package (getReferrer) is the system itself, the system UI or
   * the phone's chosen assistant app, and the caller didn't name a
   * referrer of its own (EXTRA_REFERRER, which getReferrer would report
   * instead). No new permission.
   */
  private fun systemOpened(intent: Intent): Boolean {
      if (intent.hasExtra(Intent.EXTRA_REFERRER) || intent.hasExtra(Intent.EXTRA_REFERRER_NAME)) {
          return false
      }
      val from = referrer ?: return false
      if (from.scheme != "android-app") return false
      val pkg = from.host ?: return false
      if (pkg == "android" || pkg == "com.android.systemui") return true
      // The phone's chosen assistant (Settings > Default apps), if it says.
      val assistant = try {
          android.provider.Settings.Secure.getString(contentResolver, "assistant")
      } catch (_: Exception) {
          null
      }
      return !assistant.isNullOrEmpty() && assistant.substringBefore('/') == pkg
  }

  /**
   * Fix display density for external displays (Samsung DeX, Pixel Desktop Mode).
   *
   * RN's DisplayMetricsHolder.initDisplayMetrics() sets screenDisplayMetrics via
   * wm.defaultDisplay.getRealMetrics(), which always reads from the phone display
   * (e.g. 420dpi). PixelUtil uses screenDisplayMetrics for all dp-to-px conversions,
   * causing everything to render ~4x too large on a lower-density external monitor.
   *
   * windowDisplayMetrics (from Application context) has the correct density, so we
   * copy it over. This runs in onCreate and onConfigurationChanged because RN
   * re-initializes metrics on orientation/resize changes.
   */
  private fun fixExternalDisplayDensity() {
      try {
          val screenMetrics = DisplayMetricsHolder.getScreenDisplayMetrics()
          val windowMetrics = DisplayMetricsHolder.getWindowDisplayMetrics()
          if (screenMetrics.densityDpi != windowMetrics.densityDpi) {
              screenMetrics.densityDpi = windowMetrics.densityDpi
              screenMetrics.density = windowMetrics.density
              screenMetrics.scaledDensity = windowMetrics.scaledDensity
          }
      } catch (_: Exception) {
          // DisplayMetricsHolder not yet initialized — normal on phone display
      }
  }
}
