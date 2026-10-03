import Foundation
import Capacitor
import CoreLocation
import Security

/**
 What the check-in page (lib/mobile/native.ts) asks of the phone
 (ATTENDANCE_PLAN.md §9.2, §9.4):

 - a key made inside the Secure Enclave, whose private half can never leave
   it; the page gets the public half as SubjectPublicKeyInfo DER and asks for
   signatures over the server's one-time number;
 - a fresh location fix, with whether iOS says it was simulated by software;
 - the model and app version, shown to whoever approves the phone.

 Errors reject with a code the page turns into words: LOCATION_DENIED,
 LOCATION_UNAVAILABLE, KEY_UNAVAILABLE.
 */
@objc(NizmoCheckInPlugin)
public class NizmoCheckInPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "NizmoCheckInPlugin"
    public let jsName = "NizmoCheckIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPublicKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sign", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAttestation", returnType: CAPPluginReturnPromise),
    ]

    private static let keyTag = Data("com.shsd.nizmo.check-in".utf8)
    /// The fixed start of a P-256 public key's SubjectPublicKeyInfo; iOS gives only the point after it.
    private static let spkiHeader: [UInt8] = [
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
        0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
    ]

    private var locationManager: CLLocationManager?
    /// Calls waiting for a fix; all are answered by the next fresh one.
    private var waiting: [CAPPluginCall] = []
    /// When the fix was asked for: anything taken before it is where the phone was, not where it is.
    private var askedAt = Date.distantPast
    private var giveUp: DispatchWorkItem?
    /// How long to wait for a fresh fix before saying there isn't one.
    private static let locationTimeout: TimeInterval = 30

    @objc func getInfo(_ call: CAPPluginCall) {
        var system = utsname()
        uname(&system)
        let model = withUnsafeBytes(of: &system.machine) { raw in
            String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        // A failed push registration on iOS is reported, not a crash: always worth asking.
        call.resolve(["platform": "ios", "model": model, "appVersion": version ?? NSNull(), "pushReady": true])
    }

    @objc func getPublicKey(_ call: CAPPluginCall) {
        guard let key = Self.privateKey() else {
            call.resolve(["publicKey": NSNull()])
            return
        }
        guard let encoded = Self.encodedPublicKey(of: key) else {
            call.reject("The phone's key can't be read.", "KEY_UNAVAILABLE")
            return
        }
        call.resolve(["publicKey": encoded])
    }

    /// A new key, replacing any before it: a phone registered again is a new phone to the server.
    @objc func createKey(_ call: CAPPluginCall) {
        SecItemDelete([kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: Self.keyTag] as CFDictionary)
        var error: Unmanaged<CFError>?
        var privateAttributes: [String: Any] = [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: Self.keyTag]
        var attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeySizeInBits as String: 256]
        #if targetEnvironment(simulator)
        // The simulator has no Secure Enclave; a real phone always uses it.
        privateAttributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        #else
        guard let access = SecAccessControlCreateWithFlags(kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .privateKeyUsage, &error) else {
            call.reject("A key couldn't be made on this phone.", "KEY_UNAVAILABLE")
            return
        }
        privateAttributes[kSecAttrAccessControl as String] = access
        attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
        #endif
        attributes[kSecPrivateKeyAttrs as String] = privateAttributes
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error), let encoded = Self.encodedPublicKey(of: key) else {
            call.reject("A key couldn't be made on this phone.", "KEY_UNAVAILABLE")
            return
        }
        call.resolve(["publicKey": encoded])
    }

    @objc func sign(_ call: CAPPluginCall) {
        guard let text = call.getString("text") else {
            call.reject("Nothing to sign.")
            return
        }
        guard let key = Self.privateKey() else {
            call.reject("This phone has no key yet.", "KEY_UNAVAILABLE")
            return
        }
        var error: Unmanaged<CFError>?
        // DER, as the server reads it.
        guard let signature = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, Data(text.utf8) as CFData, &error) as Data? else {
            call.reject("The phone couldn't sign.", "KEY_UNAVAILABLE")
            return
        }
        call.resolve(["signature": signature.base64EncodedString()])
    }

    @objc func getLocation(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let manager = self.locationManager ?? CLLocationManager()
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyBest
            self.locationManager = manager
            self.waiting.append(call)
            self.askedAt = Date()
            self.giveUp?.cancel()
            let giveUp = DispatchWorkItem { [weak self] in self?.fail("The phone couldn't find its location.", "LOCATION_UNAVAILABLE") }
            self.giveUp = giveUp
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.locationTimeout, execute: giveUp)
            switch manager.authorizationStatus {
            case .notDetermined:
                manager.requestWhenInUseAuthorization()
            case .denied, .restricted:
                self.fail("Location permission was refused.", "LOCATION_DENIED")
            default:
                manager.startUpdatingLocation()
            }
        }
    }

    /**
     Not yet: App Attest needs the app's Apple team, and the server has no
     verifier for it yet (lib/attendance/attestation.ts). Until then every
     check-in is flagged for the Super Admin, as decided for testing.
     */
    @objc func requestAttestation(_ call: CAPPluginCall) {
        call.resolve(["token": NSNull()])
    }

    // MARK: - Location

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard !waiting.isEmpty else { return }
        switch manager.authorizationStatus {
        case .notDetermined:
            return
        case .denied, .restricted:
            fail("Location permission was refused.", "LOCATION_DENIED")
        default:
            manager.startUpdatingLocation()
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        // Only a fix taken since it was asked for (review on #24): Core Location
        // may first hand back a cached one from when the phone was elsewhere.
        guard let location = locations.last(where: { $0.timestamp >= askedAt && $0.horizontalAccuracy >= 0 }) else { return }
        manager.stopUpdatingLocation()
        giveUp?.cancel()
        var mocked = false
        if #available(iOS 15.0, *) {
            mocked = location.sourceInformation?.isSimulatedBySoftware ?? false
        }
        let calls = waiting
        waiting = []
        for call in calls {
            call.resolve([
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : 100_000,
                "mocked": mocked,
            ])
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard let failure = error as? CLError else {
            fail("The phone couldn't find its location.", "LOCATION_UNAVAILABLE")
            return
        }
        switch failure.code {
        case .denied:
            fail("Location permission was refused.", "LOCATION_DENIED")
        case .locationUnknown:
            // Still looking: Core Location keeps trying until the timeout.
            return
        default:
            fail("The phone couldn't find its location.", "LOCATION_UNAVAILABLE")
        }
    }

    private func fail(_ message: String, _ code: String) {
        locationManager?.stopUpdatingLocation()
        giveUp?.cancel()
        let calls = waiting
        waiting = []
        for call in calls { call.reject(message, code) }
    }

    // MARK: - Key

    private static func privateKey() -> SecKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: keyTag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let found = item else { return nil }
        return (found as! SecKey)
    }

    /// SubjectPublicKeyInfo DER in base64: the fixed header, then the 65-byte point iOS gives.
    private static func encodedPublicKey(of privateKey: SecKey) -> String? {
        guard let publicKey = SecKeyCopyPublicKey(privateKey),
              let point = SecKeyCopyExternalRepresentation(publicKey, nil) as Data?,
              point.count == 65 else { return nil }
        return (Data(spkiHeader) + point).base64EncodedString()
    }
}
