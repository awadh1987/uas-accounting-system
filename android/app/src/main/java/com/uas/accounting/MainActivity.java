package com.uas.accounting;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int REQ_CODE_RECORD_AUDIO = 4101;
    private static final int REQ_CODE_NOTIFICATIONS = 4102;

    private boolean bridgeRegistered = false;
    private PermissionRequest pendingWebViewPermissionRequest = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannels();
        attachNativeBridge();
    }

    @Override
    public void onStart() {
        super.onStart();
        attachNativeBridge();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;

            NotificationChannel approvals = new NotificationChannel(
                "approvals",
                "Approvals & Governance",
                NotificationManager.IMPORTANCE_HIGH
            );
            approvals.setDescription("Financial approvals and period locks");

            NotificationChannel sync = new NotificationChannel(
                "sync",
                "Sync & Conflicts",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            sync.setDescription("Cloud/LAN background sync and conflict alerts");

            NotificationChannel security = new NotificationChannel(
                "security",
                "Security & Devices",
                NotificationManager.IMPORTANCE_HIGH
            );
            security.setDescription("Device locks, password resets, and backup restores");

            NotificationChannel general = new NotificationChannel(
                "general",
                "General Accounting",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            general.setDescription("Journal postings, low stock, and system updates");

            manager.createNotificationChannel(approvals);
            manager.createNotificationChannel(sync);
            manager.createNotificationChannel(security);
            manager.createNotificationChannel(general);
        }
    }

    private void attachNativeBridge() {
        if (bridgeRegistered || this.bridge == null) return;
        WebView webView = this.bridge.getWebView();
        if (webView == null) return;

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);

        final WebChromeClient existingClient =
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ? webView.getWebChromeClient() : null;

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebViewPermissionRequest(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingWebViewPermissionRequest == request) {
                    pendingWebViewPermissionRequest = null;
                }
                if (existingClient != null) {
                    existingClient.onPermissionRequestCanceled(request);
                }
            }

            @Override
            public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
            ) {
                if (existingClient != null) {
                    return existingClient.onShowFileChooser(view, filePathCallback, fileChooserParams);
                }
                return super.onShowFileChooser(view, filePathCallback, fileChooserParams);
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(
                String origin,
                GeolocationPermissions.Callback callback
            ) {
                if (existingClient != null) {
                    existingClient.onGeolocationPermissionsShowPrompt(origin, callback);
                } else {
                    super.onGeolocationPermissionsShowPrompt(origin, callback);
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                if (existingClient != null) {
                    return existingClient.onConsoleMessage(consoleMessage);
                }
                return super.onConsoleMessage(consoleMessage);
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                if (existingClient != null) {
                    return existingClient.onJsAlert(view, url, message, result);
                }
                return super.onJsAlert(view, url, message, result);
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                if (existingClient != null) {
                    return existingClient.onJsConfirm(view, url, message, result);
                }
                return super.onJsConfirm(view, url, message, result);
            }

            @Override
            public boolean onJsPrompt(
                WebView view,
                String url,
                String message,
                String defaultValue,
                JsPromptResult result
            ) {
                if (existingClient != null) {
                    return existingClient.onJsPrompt(view, url, message, defaultValue, result);
                }
                return super.onJsPrompt(view, url, message, defaultValue, result);
            }
        });

        webView.addJavascriptInterface(new UasNativeJsBridge(this, webView), "UasAndroidNative");
        bridgeRegistered = true;
    }

    private void handleWebViewPermissionRequest(final PermissionRequest request) {
        if (request == null) return;
        String[] resources = request.getResources();
        if (resources == null) {
            request.deny();
            return;
        }

        boolean needsAudio = false;
        List<String> grantable = new ArrayList<>();
        for (String r : resources) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                needsAudio = true;
            }
            grantable.add(r);
        }

        if (!needsAudio) {
            request.grant(grantable.toArray(new String[0]));
            return;
        }

        boolean hasAudio = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED;

        if (hasAudio) {
            request.grant(grantable.toArray(new String[0]));
        } else {
            if (pendingWebViewPermissionRequest != null) {
                try {
                    pendingWebViewPermissionRequest.deny();
                } catch (Exception ignored) {
                }
            }
            pendingWebViewPermissionRequest = request;
            ActivityCompat.requestPermissions(
                this,
                new String[]{Manifest.permission.RECORD_AUDIO},
                REQ_CODE_RECORD_AUDIO
            );
        }
    }

    @Override
    public void onRequestPermissionsResult(
        int requestCode,
        @NonNull String[] permissions,
        @NonNull int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;

        if (requestCode == REQ_CODE_RECORD_AUDIO) {
            if (pendingWebViewPermissionRequest != null) {
                final PermissionRequest req = pendingWebViewPermissionRequest;
                pendingWebViewPermissionRequest = null;
                runOnUiThread(() -> {
                    try {
                        if (granted) {
                            req.grant(req.getResources());
                        } else {
                            req.deny();
                        }
                    } catch (Exception ignored) {
                    }
                });
            }
            dispatchPermissionEvent("microphone", granted);
        } else if (requestCode == REQ_CODE_NOTIFICATIONS) {
            dispatchPermissionEvent("notifications", granted);
        }
    }

    private void dispatchPermissionEvent(final String permission, final boolean granted) {
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        final WebView webView = this.bridge.getWebView();
        runOnUiThread(() -> {
            try {
                String js = "window.dispatchEvent(new CustomEvent('uas:native-permission-result', { detail: { permission: '"
                    + permission + "', granted: " + granted + " } }));";
                webView.evaluateJavascript(js, null);
            } catch (Exception ignored) {
            }
        });
    }

    public int getUnusedAppRestrictionsCode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                boolean whitelisted = getPackageManager().isAutoRevokeWhitelisted();
                return whitelisted ? 1 : 2;
            } catch (Exception ignored) {
                return 0;
            }
        }
        return 0;
    }

    public static class UasNativeJsBridge {
        private final MainActivity activity;
        private final WebView webView;

        public UasNativeJsBridge(MainActivity activity, WebView webView) {
            this.activity = activity;
            this.webView = webView;
        }

        @JavascriptInterface
        public String checkMicrophonePermission() {
            boolean granted = ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED;
            boolean rationale = ActivityCompat.shouldShowRequestPermissionRationale(
                activity,
                Manifest.permission.RECORD_AUDIO
            );
            int unusedCode = activity.getUnusedAppRestrictionsCode();
            boolean unusedEnabled = unusedCode >= 2;
            return "{\"granted\":" + granted
                + ",\"shouldShowRationale\":" + rationale
                + ",\"unusedAppRestrictionsStatus\":" + unusedCode
                + ",\"unusedRestrictionsEnabled\":" + unusedEnabled + "}";
        }

        @JavascriptInterface
        public boolean requestMicrophonePermission() {
            boolean granted = ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED;
            if (granted) return true;
            activity.runOnUiThread(() -> ActivityCompat.requestPermissions(
                activity,
                new String[]{Manifest.permission.RECORD_AUDIO},
                REQ_CODE_RECORD_AUDIO
            ));
            return false;
        }

        @JavascriptInterface
        public int checkUnusedAppRestrictionsStatus() {
            return activity.getUnusedAppRestrictionsCode();
        }

        @JavascriptInterface
        public boolean openAppSettings() {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.fromParts("package", activity.getPackageName(), null));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean openUnusedAppSettings() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Intent intent = new Intent("android.intent.action.AUTO_REVOKE_PERMISSIONS");
                    intent.setData(Uri.fromParts("package", activity.getPackageName(), null));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(intent);
                    return true;
                }
            } catch (Exception ignored) {
            }
            return openAppSettings();
        }

        @JavascriptInterface
        public boolean checkNotificationPermission() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                return ContextCompat.checkSelfPermission(
                    activity,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED;
            }
            return NotificationManagerCompat.from(activity).areNotificationsEnabled();
        }

        @JavascriptInterface
        public boolean requestNotificationPermission() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                boolean granted = ContextCompat.checkSelfPermission(
                    activity,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED;
                if (granted) return true;
                activity.runOnUiThread(() -> ActivityCompat.requestPermissions(
                    activity,
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    REQ_CODE_NOTIFICATIONS
                ));
                return false;
            }
            return true;
        }

        @JavascriptInterface
        public boolean registerNotificationChannels() {
            activity.createNotificationChannels();
            return true;
        }

        @JavascriptInterface
        public boolean showLocalNotification(final String channelId, final String title, final String body) {
            try {
                if (!checkNotificationPermission()) {
                    return false;
                }
                activity.createNotificationChannels();
                String ch = (channelId != null && !channelId.trim().isEmpty()) ? channelId.trim() : "general";
                NotificationCompat.Builder builder = new NotificationCompat.Builder(activity, ch)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle(title != null ? title : "UAS ERP")
                    .setContentText(body != null ? body : "")
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body != null ? body : ""))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true);

                int notifId = (int) (System.currentTimeMillis() & 0xFFFFFF);
                NotificationManagerCompat.from(activity).notify(notifId, builder.build());
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean printCurrentPage(final String jobName) {
            final String safeTitle = (jobName != null && !jobName.trim().isEmpty())
                ? jobName.trim()
                : "UAS-Accounting-Document";
            activity.runOnUiThread(() -> {
                try {
                    PrintManager printManager = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                    if (printManager != null && webView != null) {
                        PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(safeTitle);
                        printManager.print(safeTitle, adapter, new PrintAttributes.Builder().build());
                    }
                } catch (Exception ignored) {
                }
            });
            return true;
        }

        @JavascriptInterface
        public boolean shareBase64File(
            final String filename,
            final String mimeType,
            final String base64Data,
            final String title
        ) {
            try {
                String cleanName = (filename != null && !filename.trim().isEmpty())
                    ? filename.trim().replaceAll("[^a-zA-Z0-9._\\-\u0600-\u06FF]", "_")
                    : "uas-export.xlsx";
                String cleanMime = (mimeType != null && !mimeType.trim().isEmpty())
                    ? mimeType.trim()
                    : "application/octet-stream";

                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                File outFile = new File(activity.getCacheDir(), cleanName);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(bytes);
                    fos.flush();
                }

                Uri contentUri = FileProvider.getUriForFile(
                    activity,
                    activity.getPackageName() + ".fileprovider",
                    outFile
                );

                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType(cleanMime);
                shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                shareIntent.putExtra(Intent.EXTRA_SUBJECT, title != null ? title : cleanName);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(
                    shareIntent,
                    (title != null && !title.trim().isEmpty()) ? title : cleanName
                );
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(chooser);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean openExternalUrl(final String url) {
            if (url == null || url.trim().isEmpty()) return false;
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }
}
