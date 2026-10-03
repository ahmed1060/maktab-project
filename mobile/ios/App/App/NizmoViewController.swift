import UIKit
import Capacitor

/// The app's screen: Capacitor's, with the app's own check-in plugin registered (mobile/README.md).
class NizmoViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NizmoCheckInPlugin())
    }
}
