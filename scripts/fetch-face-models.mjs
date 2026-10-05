// Puts the face check's models and runtimes into public/face-models, where
// the app loads them (lib/mobile/face-check). Runs before dev and build; the
// output isn't committed (it's ~250 MB).
//
// - InsightFace buffalo_l (SCRFD-10GF detector, ArcFace ResNet50): downloaded
//   once from InsightFace's GitHub release and checked against its SHA-256,
//   then kept in a cache that survives builds (Vercel restores .next/cache).
//   NON-COMMERCIAL weights, for testing only (mobile/FACE_CHECK.md).
// - MediaPipe Face Landmarker: downloaded once, checked the same way.
//   (Apache-2.0.)
// - MiniFASNet (anti-spoofing, Apache-2.0): converted to ONNX once and
//   committed, in lib/mobile/face-check/weights.
// - The ONNX Runtime and MediaPipe WebAssembly files: from node_modules.
//
// The recognition model is 174 MB: over Vercel's 100 MB limit for one static
// file on the Hobby plan, so it is served in parts of at most 40 MB, which the
// phone joins and checks against the manifest's SHA-256.
//
// Only where the face check for testing is offered (NEXT_PUBLIC_FACE_PROTOTYPE=1):
// anywhere else, production above all, nothing is downloaded and no model is
// published, and any left from before are removed (review on #47).
// Where it is on, FACE_MODELS=skip leaves everything as it is (for a quick dev start).
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import JSZip from "jszip"
import nextEnv from "@next/env"

// The same .env files next dev and next build read, so the flag set there counts here too (review on #47).
nextEnv.loadEnvConfig(process.cwd(), process.env.npm_lifecycle_event === "predev")

const OUT = "public/face-models/v2"

// Off: whatever else is set, nothing is published (review on #47), so this comes before FACE_MODELS=skip.
if (process.env.NEXT_PUBLIC_FACE_PROTOTYPE !== "1") {
    rmSync("public/face-models", { recursive: true, force: true })
    console.log("fetch-face-models: the face check for testing is off (NEXT_PUBLIC_FACE_PROTOTYPE isn't 1); no models")
    process.exit(0)
}
if (process.env.FACE_MODELS === "skip") {
    console.log("fetch-face-models: skipped (FACE_MODELS=skip)")
    process.exit(0)
}
const CACHE = existsSync(".next") ? ".next/cache/face-models" : "node_modules/.cache/face-models"
const PART = 40 * 1024 * 1024

const DOWNLOADS = {
    buffalo: {
        url: "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip",
        sha256: "80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f",
        file: "buffalo_l.zip",
    },
    landmarker: {
        url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
        file: "face_landmarker.task",
    },
}
// The two files taken from buffalo_l, and what they must be.
const FROM_BUFFALO = {
    "det_10g.onnx": "5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91",
    "w600k_r50.onnx": "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43",
}

const sha256 = buf => createHash("sha256").update(buf).digest("hex")

async function cached({ url, sha256: want, file }) {
    mkdirSync(CACHE, { recursive: true })
    const path = join(CACHE, file)
    if (existsSync(path) && sha256(readFileSync(path)) === want) return readFileSync(path)
    console.log(`fetch-face-models: downloading ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const got = sha256(buf)
    // A changed file is never served: the numbers this was tested with are for these exact weights.
    if (got !== want) throw new Error(`${url}: SHA-256 ${got}, expected ${want}`)
    writeFileSync(path, buf)
    return buf
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, "ort"), { recursive: true })
mkdirSync(join(OUT, "mediapipe"), { recursive: true })

const zip = await JSZip.loadAsync(await cached(DOWNLOADS.buffalo))
const manifest = { files: {} }
for (const [name, want] of Object.entries(FROM_BUFFALO)) {
    const entry = zip.file(new RegExp(`(^|/)${name.replace(".", "\\.")}$`))[0]
    if (!entry) throw new Error(`buffalo_l.zip has no ${name}`)
    const buf = await entry.async("nodebuffer")
    if (sha256(buf) !== want) throw new Error(`${name}: SHA-256 mismatch`)
    const parts = []
    for (let i = 0, n = 0; i < buf.length; i += PART, n++) {
        const part = `${name}.part${n}`
        writeFileSync(join(OUT, part), buf.subarray(i, i + PART))
        parts.push(part)
    }
    manifest.files[name] = { parts, size: buf.length, sha256: want }
}
const landmarker = await cached(DOWNLOADS.landmarker)
writeFileSync(join(OUT, "face_landmarker.task"), landmarker)
// Everything the phone downloads, for its progress bar.
manifest.total = Object.values(manifest.files).reduce((s, f) => s + f.size, 0) + landmarker.length
for (const f of readdirSync("lib/mobile/face-check/weights").filter(f => f.endsWith(".onnx"))) {
    copyFileSync(join("lib/mobile/face-check/weights", f), join(OUT, f))
    manifest.total += statSync(join(OUT, f)).size
}
copyFileSync("node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", join(OUT, "ort/ort-wasm-simd-threaded.wasm"))
copyFileSync("node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", join(OUT, "ort/ort-wasm-simd-threaded.mjs"))
for (const f of readdirSync("node_modules/@mediapipe/tasks-vision/wasm"))
    copyFileSync(join("node_modules/@mediapipe/tasks-vision/wasm", f), join(OUT, "mediapipe", f))
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1))
console.log(`fetch-face-models: models into ${OUT}`)
