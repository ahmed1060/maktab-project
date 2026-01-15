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

    // Regex to find patterns like q=lat,lng or just lat,lng
    // We look for two sequences of numbers/decimals separated by a comma
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
