# Capacitor Core & Plugins (Reflection Bridge)
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.PluginMethod <methods>;
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve WebView & JS Bridge Annotations
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-dontwarn com.getcapacitor.**
-dontwarn org.apache.cordova.**
