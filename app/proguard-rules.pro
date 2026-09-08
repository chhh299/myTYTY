# 保证 JavascriptInterface 桥接类及方法不被混淆
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keep class com.aliyun.tingwu.assistant.bridge.** { *; }
-keepclassmembers class com.aliyun.tingwu.assistant.bridge.** { *; }

# WebKit 依赖保留
-keep class androidx.webkit.** { *; }
