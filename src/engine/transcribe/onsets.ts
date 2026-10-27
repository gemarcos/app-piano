// Onset map for basic-pitch's outputToNotesPoly (which is then called with inferOnsets = false). Pure.
//
// 1. Inferred onsets: basic-pitch adds onsets where frame activations jump, as max(onsets, frameDiff * onsetMax /
//    frameDiffMax). evaluateModel runs the model on overlapping ~2 s windows and concatenates MODEL_WINDOW_FRAMES
//    frames per window; frame activations are not continuous across that seam, so a note that is simply sustained
//    through it gets a large "jump" and a spurious onset (a duplicated note every ~1.65 s of held notes). Here frame
//    differences never straddle a window seam (real attacks on the seam still come through the onset head).
// 2. Optional same-pitch non-maximum suppression: low notes often have double-peaked onsets ~50 ms apart; the decoder
//    walks onsets backwards, so the late peak won and the true onset was dropped. Only the strongest peak survives.
// 3. Optional per-pitch scaling (e.g. a lower effective threshold for bass notes, whose onsets are weaker).
// 4. Exact plateaus: the rescaled strongest frame difference equals the global onset maximum; next to that note's own
//    onset peak the two frames form a plateau that the strict argRelMax never picks (the note was silently lost).
//    Plateau peaks are broken toward their first frame.

/** Smaller than any float32 step near the thresholds, so it never reorders distinct values. */
const TIE_EPSILON = 1e-12

/**
 * Output frames contributed by each model window: ANNOT_N_FRAMES (172) minus the 2 x 15 overlap frames that
 * basic-pitch's evaluateModel trims. Window k covers output frames [142k, 142k + 142).
 */
export const MODEL_WINDOW_FRAMES = 142

export interface OnsetOptions {
  /** Add onsets from large frame-activation increases (basic-pitch's default). Default true. */
  infer?: boolean
  /** Frame-difference orders (basic-pitch uses 2). */
  nDiff?: number
  /** Frames per model window: differences never straddle a window seam. 0 disables. Default MODEL_WINDOW_FRAMES. */
  windowFrames?: number
  /** Keep only the strongest onset of each pitch within ±radius frames. 0 (default) disables. */
  nmsRadius?: number
  /** Per-pitch multipliers (one per column); scaling by k is the same as dividing that pitch's threshold by k. */
  columnScale?: ArrayLike<number>
}

/**
 * @param onsets [time][pitch] onset activations (not modified)
 * @param frames [time][pitch] frame activations (not modified)
 * @returns a new [time][pitch] onset map for outputToNotesPoly(…, inferOnsets = false)
 */
export function prepareOnsets(onsets: number[][], frames: number[][], options: OnsetOptions = {}): number[][] {
  const { infer = true, nDiff = 2, windowFrames = MODEL_WINDOW_FRAMES, nmsRadius = 0, columnScale } = options
  const nFrames = Math.min(onsets.length, frames.length)
  const width = nFrames ? Math.min(onsets[0].length, frames[0].length) : 0
  const out = onsets.slice(0, nFrames).map((row) => row.slice())

  if (infer && nFrames > nDiff && width) addInferredOnsets(out, onsets, frames, nFrames, width, nDiff, windowFrames)
  if (nmsRadius > 0) suppressNonMaxima(out, nFrames, width, nmsRadius)
  if (columnScale) {
    for (const row of out) for (let c = 0; c < width; c++) row[c] *= columnScale[c] ?? 1
  }
  breakPlateaus(out, nFrames, width)
  return out
}

function addInferredOnsets(
  out: number[][],
  onsets: number[][],
  frames: number[][],
  nFrames: number,
  width: number,
  nDiff: number,
  windowFrames: number,
) {
  let onsetMax = 0
  for (let r = 0; r < nFrames; r++) for (let c = 0; c < width; c++) if (onsets[r][c] > onsetMax) onsetMax = onsets[r][c]

  // frameDiff[r] = max(0, min over n of frames[r] - frames[r - n]), using only frames of r's own window.
  // The first nDiff rows stay 0 (as in basic-pitch).
  const diff = new Float64Array(nFrames * width)
  let diffMax = 0
  for (let r = nDiff; r < nFrames; r++) {
    const windowStart = windowFrames > 0 ? r - (r % windowFrames) : 0
    const orders = Math.min(nDiff, r - windowStart)
    if (orders < 1) continue
    for (let c = 0; c < width; c++) {
      let m = Infinity
      for (let n = 1; n <= orders; n++) m = Math.min(m, frames[r][c] - frames[r - n][c])
      const v = m > 0 ? m : 0
      diff[r * width + c] = v
      if (v > diffMax) diffMax = v
    }
  }
  if (!(diffMax > 0)) return
  const scale = onsetMax / diffMax
  for (let r = nDiff; r < nFrames; r++) {
    for (let c = 0; c < width; c++) {
      const v = diff[r * width + c] * scale
      if (v > out[r][c]) out[r][c] = v
    }
  }
}

/** Zeroes every value that has a larger one (or an equal, earlier one) of the same pitch within ±radius frames. */
function suppressNonMaxima(m: number[][], nFrames: number, width: number, radius: number) {
  const column = new Float64Array(nFrames)
  for (let c = 0; c < width; c++) {
    for (let r = 0; r < nFrames; r++) column[r] = m[r][c]
    for (let r = 0; r < nFrames; r++) {
      const v = column[r]
      if (!(v > 0)) continue
      const to = Math.min(nFrames - 1, r + radius)
      for (let k = Math.max(0, r - radius); k <= to; k++) {
        if (k !== r && (column[k] > v || (column[k] === v && k < r))) {
          m[r][c] = 0
          break
        }
      }
    }
  }
}

/** A run of equal values that is higher than both neighbours keeps its first frame as the single peak. */
function breakPlateaus(m: number[][], nFrames: number, width: number) {
  for (let c = 0; c < width; c++) {
    let r = 1
    while (r < nFrames) {
      const value = m[r - 1][c]
      if (value > 0 && m[r][c] === value) {
        const start = r - 1
        let end = r
        while (end + 1 < nFrames && m[end + 1][c] === value) end++
        const before = start > 0 ? m[start - 1][c] : -Infinity
        const after = end + 1 < nFrames ? m[end + 1][c] : -Infinity
        if (before < value && after < value) {
          for (let k = start + 1; k <= end; k++) m[k][c] = value - TIE_EPSILON * (k - start)
        }
        r = end + 1
      } else {
        r++
      }
    }
  }
}
