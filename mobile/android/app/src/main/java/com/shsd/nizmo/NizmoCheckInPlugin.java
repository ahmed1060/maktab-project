package com.shsd.nizmo;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.play.core.integrity.IntegrityManager;
import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.IntegrityTokenRequest;

import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.spec.ECGenParameterSpec;

/**
 * What the check-in page (lib/mobile/native.ts) asks of the phone
 * (ATTENDANCE_PLAN.md §9.2, §9.4):
 *
 * - a key made inside the Android Keystore, in StrongBox when the phone has
 *   it, whose private half can never leave the hardware; the page gets the
 *   public half as SubjectPublicKeyInfo DER and asks for signatures over the
 *   server's one-time number;
 * - a fresh location fix, with whether Android says it came from a mock
 *   provider;
 * - the model and app version, shown to whoever approves the phone;
 * - a Play Integrity token, proof the request came from our app as Play
 *   installed it, on a genuine device.
 *
 * Errors reject with a code the page turns into words: LOCATION_DENIED,
 * LOCATION_UNAVAILABLE, KEY_UNAVAILABLE.
 */
@CapacitorPlugin(
    name = "NizmoCheckIn",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION })
    }
)
public class NizmoCheckInPlugin extends Plugin {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "nizmo-check-in";
    /** How long to wait for a fix before saying there isn't one. */
    private static final long LOCATION_TIMEOUT_MS = 30_000;
    /** A fix older than this says where the phone was, not where it is. */
    private static final long MAX_FIX_AGE_MS = 30_000;

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject out = new JSObject();
        out.put("platform", "android");
        out.put("model", (Build.MANUFACTURER + " " + Build.MODEL).trim());
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            out.put("appVersion", info.versionName);
        } catch (Exception e) {
            out.put("appVersion", null);
        }
        call.resolve(out);
    }

    @PluginMethod
    public void getPublicKey(PluginCall call) {
        try {
            KeyStore store = keyStore();
            Certificate cert = store.getCertificate(KEY_ALIAS);
            JSObject out = new JSObject();
            out.put("publicKey", cert == null ? null : encode(cert.getPublicKey()));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("The phone's key store can't be read.", "KEY_UNAVAILABLE", e);
        }
    }

    /** A new key, replacing any before it: a phone registered again is a new phone to the server. */
    @PluginMethod
    public void createKey(PluginCall call) {
        try {
            KeyStore store = keyStore();
            if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS);
            PublicKey key = null;
            // StrongBox, the separate secure chip, where the phone has one (Android 9+); else the Keystore's own hardware.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                try {
                    key = generate(true);
                } catch (Exception e) {
                    key = null;
                }
            }
            if (key == null) key = generate(false);
            JSObject out = new JSObject();
            out.put("publicKey", encode(key));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("A key couldn't be made on this phone.", "KEY_UNAVAILABLE", e);
        }
    }

    @PluginMethod
    public void sign(PluginCall call) {
        String text = call.getString("text");
        if (text == null) {
            call.reject("Nothing to sign.");
            return;
        }
        try {
            KeyStore store = keyStore();
            PrivateKey key = (PrivateKey) store.getKey(KEY_ALIAS, null);
            if (key == null) {
                call.reject("This phone has no key yet.", "KEY_UNAVAILABLE");
                return;
            }
            Signature signer = Signature.getInstance("SHA256withECDSA");
            signer.initSign(key);
            signer.update(text.getBytes(StandardCharsets.UTF_8));
            JSObject out = new JSObject();
            // DER, as the server reads it.
            out.put("signature", Base64.encodeToString(signer.sign(), Base64.NO_WRAP));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("The phone couldn't sign.", "KEY_UNAVAILABLE", e);
        }
    }

    @PluginMethod
    public void getLocation(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationPermission");
            return;
        }
        locate(call);
    }

    @PermissionCallback
    private void locationPermission(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) locate(call);
        else call.reject("Location permission was refused.", "LOCATION_DENIED");
    }

    /**
     * Google Play Integrity, classic request (§9.4): a token from Google over
     * a nonce made from the text the page gives (attestedText: the server's
     * one-time number and its purpose), which the server has Google decode.
     * The nonce is the text's SHA-256, base64url, as the server computes it.
     *
     * The app's Google Cloud project number comes from capacitor.config.ts
     * (plugins.NizmoCheckIn.cloudProjectNumber); a build installed from Play
     * can do without it. Any failure gives no token rather than an error:
     * the server flags or refuses, and says why.
     */
    @PluginMethod
    public void requestAttestation(PluginCall call) {
        String text = call.getString("text");
        if (text == null) {
            resolveToken(call, null);
            return;
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            String nonce = Base64.encodeToString(digest, Base64.URL_SAFE | Base64.NO_WRAP);
            IntegrityTokenRequest.Builder request = IntegrityTokenRequest.builder().setNonce(nonce);
            String project = getConfig().getString("cloudProjectNumber");
            if (project != null && !project.isEmpty()) request.setCloudProjectNumber(Long.parseLong(project));
            IntegrityManager manager = IntegrityManagerFactory.create(getContext().getApplicationContext());
            manager.requestIntegrityToken(request.build())
                .addOnSuccessListener(response -> resolveToken(call, response.token()))
                .addOnFailureListener(error -> resolveToken(call, null));
        } catch (Exception e) {
            resolveToken(call, null);
        }
    }

    private static void resolveToken(PluginCall call, String token) {
        JSObject out = new JSObject();
        out.put("token", token);
        call.resolve(out);
    }

    // ---

    private static KeyStore keyStore() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        return store;
    }

    private static PublicKey generate(boolean strongBox) throws Exception {
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256);
        if (strongBox) spec.setIsStrongBoxBacked(true);
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE);
        generator.initialize(spec.build());
        return generator.generateKeyPair().getPublic();
    }

    /** SubjectPublicKeyInfo DER, as Android gives it, in base64. */
    private static String encode(PublicKey key) {
        return Base64.encodeToString(key.getEncoded(), Base64.NO_WRAP);
    }

    private void locate(PluginCall call) {
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (manager == null || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && !manager.isLocationEnabled())) {
            call.reject("Location is turned off.", "LOCATION_DENIED");
            return;
        }
        String provider = providerOf(manager);
        if (provider == null) {
            call.reject("No location provider is available.", "LOCATION_UNAVAILABLE");
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // A fresh fix, never a cached one: a cached fix says where the phone was, not where it is.
                manager.getCurrentLocation(provider, null, getContext().getMainExecutor(), location -> answer(call, location));
            } else {
                singleUpdate(manager, provider, call);
            }
        } catch (SecurityException e) {
            call.reject("Location permission was refused.", "LOCATION_DENIED", e);
        }
    }

    private static String providerOf(LocationManager manager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && manager.hasProvider(LocationManager.FUSED_PROVIDER)) return LocationManager.FUSED_PROVIDER;
        if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) return LocationManager.GPS_PROVIDER;
        if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) return LocationManager.NETWORK_PROVIDER;
        return null;
    }

    @SuppressWarnings("deprecation")
    private void singleUpdate(LocationManager manager, String provider, PluginCall call) {
        Handler handler = new Handler(Looper.getMainLooper());
        final boolean[] done = { false };
        LocationListener listener = new LocationListener() {
            @Override
            public void onLocationChanged(@NonNull Location location) {
                if (done[0]) return;
                done[0] = true;
                answer(call, location);
            }
        };
        handler.postDelayed(() -> {
            if (done[0]) return;
            done[0] = true;
            manager.removeUpdates(listener);
            answer(call, null);
        }, LOCATION_TIMEOUT_MS);
        manager.requestSingleUpdate(provider, listener, Looper.getMainLooper());
    }

    /** How long ago the fix was taken, on the clock that doesn't jump when the time is changed. */
    private static long ageMillis(Location location) {
        return (SystemClock.elapsedRealtimeNanos() - location.getElapsedRealtimeNanos()) / 1_000_000;
    }

    @SuppressWarnings("deprecation")
    private static void answer(PluginCall call, Location location) {
        // getCurrentLocation may hand back a recent cached fix; one taken before
        // the person asked is refused rather than signed (review on #24).
        if (location == null || ageMillis(location) > MAX_FIX_AGE_MS) {
            call.reject("The phone couldn't find its location.", "LOCATION_UNAVAILABLE");
            return;
        }
        JSObject out = new JSObject();
        out.put("latitude", location.getLatitude());
        out.put("longitude", location.getLongitude());
        out.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 100_000);
        out.put("mocked", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? location.isMock() : location.isFromMockProvider());
        call.resolve(out);
    }
}
