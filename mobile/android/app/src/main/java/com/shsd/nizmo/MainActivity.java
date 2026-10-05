package com.shsd.nizmo;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin, registered before the bridge starts (mobile/README.md).
        registerPlugin(NizmoCheckInPlugin.class);
        super.onCreate(savedInstanceState);

        // The offline page (server.errorPath) is for a connection that failed, not for an error page the
        // site sends itself: Capacitor's client shows it for both on Android, which would have replaced the
        // site's own 404 or 500 with "can't be reached" (review on #31). A failed connection still goes to
        // it through onReceivedError, as on iOS, where only failed navigations show it.
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                // The site's own response stays on screen. (Capacitor's version also tells its web view
                // listeners; none of the plugins here listens for HTTP errors.)
            }
        });

        // Back goes back a page, as in a browser; from the first page it puts the app in the background,
        // as other apps do, rather than closing it. Capacitor's own activity has no back handling, so
        // without this every press closed the app, whatever page it was on.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge() != null ? getBridge().getWebView() : null;
                if (web != null && web.canGoBack()) web.goBack();
                else moveTaskToBack(true);
            }
        });
    }
}
