/**
 * Runs the face check's recognition (lib/mobile/face-check) on photos with
 * known identities, in Node, with the same ONNX runtime as the phone. For
 * checking the pipeline against InsightFace's Python reference and choosing
 * the match threshold; not part of the build.
 *
 *   tsx scripts/face-check-eval.mts <models dir> <photos dir> [reference embeddings .json]
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import sharp from "sharp"
import * as ort from "onnxruntime-web"
import { align, cosine, detect, embed, type Run } from "../lib/mobile/face-check/models"
import { ANTISPOOF_MODELS, liveScore } from "../lib/mobile/face-check/antispoof"

async function runner(file: string): Promise<Run> {
    const session = await ort.InferenceSession.create(file)
    return async (input, dims) => {
        const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, dims as number[]) })
        return session.outputNames.map(n => out[n].data as Float32Array)
    }
}

const [models, photos, refFile] = process.argv.slice(2)
const det = await runner(join(models, "det_10g.onnx"))
const rec = await runner(join(models, "w600k_r50.onnx"))
const fas = await Promise.all(ANTISPOOF_MODELS.map(m => runner(join(models, m.file))))
const ref: Record<string, number[]> = refFile ? JSON.parse(readFileSync(refFile, "utf8")) : {}
const emb: Record<string, number[]> = {}
for (const f of readdirSync(photos).filter(f => f.endsWith(".jpg")).sort((a, b) => (parseInt(a.slice(3)) || 0) - (parseInt(b.slice(3)) || 0))) {
    const { data, info } = await sharp(join(photos, f)).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const t = Date.now()
    const faces = await detect(det, { data, width: info.width, height: info.height })
    const td = Date.now() - t
    if (!faces.length) { console.log(f, "no face"); continue }
    const face = faces.reduce((a, b) => ((b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) > (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) ? b : a))
    const t2 = Date.now()
    const e = await embed(rec, align({ data, width: info.width, height: info.height }, face))
    const name = f.slice(0, -4)
    const live = await liveScore(fas, { data, width: info.width, height: info.height }, face)
    emb[name] = e
    console.log(name, `live=${live.toFixed(2)} faces=${faces.length} score=${face.score.toFixed(2)} detect=${td}ms embed=${Date.now() - t2}ms`, ref[name] ? `vs reference ${cosine(e, ref[name]).toFixed(4)}` : "")
}
console.log(JSON.stringify(emb).length > 0 ? "EMB_JSON " + JSON.stringify(emb) : "")
