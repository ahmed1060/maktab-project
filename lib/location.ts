/**
 * Extraction and distance calculation logic for task locations.
 */

interface Coordinates {
    lat: number;
    lng: number;
}

/**
 * Extracts coordinates from a Google Maps URL or string.
 * Supports formats like:
 * - https://www.google.com/maps?q=30.0444,31.2357
 * - 30.0444,31.2357
 */
export function extractCoords(locationStr: string | null | undefined): Coordinates | null {
    if (!locationStr) return null;

    // Check if it's a JSON string
    if (locationStr.trim().startsWith('{')) {
        try {
            const data = JSON.parse(locationStr);
            const lat = parseFloat(data.latitude || data.lat);
            const lng = parseFloat(data.longitude || data.lng || data.link?.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/)?.[1]);
            // If link extraction failed, try another match
            let finalLng = lng;
            if (isNaN(lng) && data.link) {
                const match = data.link.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
                if (match) finalLng = parseFloat(match[2]);
            }
            if (!isNaN(lat) && !isNaN(finalLng)) {
                return { lat, lng: finalLng };
            }
        } catch { }
    }

    // Regex to find patterns like q=lat,lng or just lat,lng
    const regex = /(?:q=)?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/;
    const match = locationStr.match(regex);

    if (match && match[1] && match[2]) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (!isNaN(lat) && !isNaN(lng)) {
            return { lat, lng };
        }
    }

    return null;
}

/**
 * Calculates the distance between two coordinates in meters using the Haversine formula.
 */
export function calculateDistance(coord1: Coordinates, coord2: Coordinates): number {
    const R = 6371e3; // Earth's radius in meters
    const phi1 = (coord1.lat * Math.PI) / 180;
    const phi2 = (coord2.lat * Math.PI) / 180;
    const deltaPhi = ((coord2.lat - coord1.lat) * Math.PI) / 180;
    const deltaLambda = ((coord2.lng - coord1.lng) * Math.PI) / 180;

    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

/**
 * The browser's own estimate, in metres, of how far out the position may be —
 * the radius it is 68% confident the person is inside.
 *
 * Captured because everything downstream depends on it and nothing had it. A
 * satellite fix reports five to twenty metres; a Wi-Fi fix twenty to a hundred;
 * a fix derived from the network, indoors or on a laptop, can report several
 * kilometres. All three arrive through the same callback and are identical once
 * this number is discarded — which is what the app did, and why verification
 * marked people wrong with no idea whether the reading was worth ten metres or
 * ten kilometres.
 *
 * Returns null for every position recorded before this was kept. That is a
 * meaningful answer, not a missing one: see verifyLocation.
 */
export function extractAccuracy(locationStr: string | null | undefined): number | null {
    if (!locationStr || !locationStr.trim().startsWith('{')) return null;
    try {
        const data = JSON.parse(locationStr);
        const accuracy = Number(data.accuracy);
        // Zero or negative is not a confident reading, it is a broken one.
        return Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null;
    } catch {
        return null;
    }
}

export type VerificationStatus = 'CORRECT' | 'WRONG' | 'UNVERIFIED';

/**
 * Whether a submitted position is at the task's location.
 *
 * Comparing a point to a point is what made this unreliable: it forces a
 * verdict out of a reading that may not support one. Comparing the submitted
 * *circle* to the target admits the third answer, which is the fix.
 *
 *   CORRECT      distance + accuracy <= radius     confidently inside
 *   WRONG        distance - accuracy >  radius     confidently outside
 *   UNVERIFIED   otherwise                         the reading cannot decide
 *
 * The third state matters because of where this leads. A location marked WRONG
 * can justify a penalty, a penalty becomes a salary adjustment, and a salary
 * adjustment becomes a line on a payslip — so an imprecise GPS reading has a
 * path all the way to somebody's pay. Sending the genuinely ambiguous handful
 * to a person is the whole point; guessing is what costs the trust.
 *
 * Named for what it returns rather than what it does, because
 * TaskService.verifyLocation already exists and is a different thing entirely:
 * a reviewer overriding a verdict by hand. Two of those under one name in the
 * same file is a mistake waiting for whoever reads it next.
 *
 * A reading with no recorded accuracy is treated as exact. Every position taken
 * before accuracy was captured has none, and callers must not re-decide those:
 * they were judged under the old rule and in some cases already acted on.
 */
export function locationVerdict(
    target: Coordinates,
    submitted: Coordinates,
    radiusMeters: number,
    accuracyMeters: number | null,
): VerificationStatus {
    const distance = calculateDistance(target, submitted);
    const accuracy = accuracyMeters ?? 0;

    if (distance + accuracy <= radiusMeters) return 'CORRECT';
    if (distance - accuracy > radiusMeters) return 'WRONG';
    return 'UNVERIFIED';
}
