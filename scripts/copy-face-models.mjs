// Copies the face check prototype's model weights (lib/mobile/face-prototype)
// from @vladmandic/face-api into public/face-models, where the app loads
// them. Run before dev and build; the copies aren't committed.
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const from = "node_modules/@vladmandic/face-api/model"
const to = "public/face-models"
const MODELS = ["tiny_face_detector_model", "face_landmark_68_model", "face_recognition_model"]

if (!existsSync(from)) {
    console.warn(`copy-face-models: ${from} not found; the face check prototype won't load`)
    process.exit(0)
}
mkdirSync(to, { recursive: true })
for (const m of MODELS) {
    for (const file of [`${m}-weights_manifest.json`, `${m}.bin`]) copyFileSync(join(from, file), join(to, file))
}
console.log(`copy-face-models: ${MODELS.length} models into ${to}`)
