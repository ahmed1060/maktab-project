package com.shsd.nizmo;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin, registered before the bridge starts (mobile/README.md).
        registerPlugin(NizmoCheckInPlugin.class);
        super.onCreate(savedInstanceState);

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
