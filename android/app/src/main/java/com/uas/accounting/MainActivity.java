package com.uas.accounting;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;

public class MainActivity extends BridgeActivity {
    private boolean bridgeRegistered = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        attachNativeBridge();
    }

    @Override
    public void onStart() {
        super.onStart();
        attachNativeBridge();
    }

    private void attachNativeBridge() {
        if (bridgeRegistered || this.bridge == null) return;
        WebView webView = this.bridge.getWebView();
        if (webView == null) return;
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.addJavascriptInterface(new UasNativeJsBridge(this, webView), "UasAndroidNative");
        bridgeRegistered = true;
    }

    public static class UasNativeJsBridge {
        private final MainActivity activity;
        private final WebView webView;

        public UasNativeJsBridge(MainActivity activity, WebView webView) {
            this.activity = activity;
            this.webView = webView;
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
