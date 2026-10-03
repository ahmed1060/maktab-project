package com.shsd.nizmo;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin, registered before the bridge starts (mobile/README.md).
        registerPlugin(NizmoCheckInPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
