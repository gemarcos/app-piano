// Onset map for basic-pitch's outputToNotesPoly (which is then called with inferOnsets = false). Pure.
//
// basic-pitch infers extra onsets as max(onsets, frameDiff * onsetMax / frameDiffMax). The strongest frame
// difference is therefore rescaled to exactly the global onset maximum; when it lands next to that note's
// own (equal) onset peak, the two frames form a plateau that the strict argRelMax never picks, and the note
// is silently lost (typically the loudest note of a short clip). Saturated activations can plateau too.
// This reproduces the library's inference and then breaks exact plateau peaks toward their first frame.

/** Smaller than any float32 step near the thresholds, so it never reorders distinct values. */
const TIE_EPSILON = 1e-12

/**
 * @param onsets [time][pitch] onset activations (not modified)
 * @param frames [time][pitch] frame activations (not modified)
 * @param inferOnsets add onsets from large frame-activation increases (basic-pitch's default)
 * @param nDiff frame-difference orders (basic-pitch uses 2)
 */
export function prepareOnsets(onsets: number[][], frames: number[][], inferOnsets = true, nDiff = 2): number[][] {
  const nFrames = Math.min(onsets.length, frames.length)
  const width = nFrames ? Math.min(onsets[0].length, frames[0].length) : 0
  const out = onsets.slice(0, nFrames).map((row) => row.slice())

  if (inferOnsets && nFrames > nDiff && width) {
    let onsetMax = 0
    for (let r = 0; r < nFrames; r++) for (let c = 0; c < width; c++) if (onsets[r][c] > onsetMax) onsetMax = onsets[r][c]

    // frameDiff[r] = max(0, min over n of frames[r] - frames[r - n]); the first nDiff rows stay 0.
    const diff = new Float64Array(nFrames * width)
    let diffMax = 0
    for (let r = nDiff; r < nFrames; r++) {
      for (let c = 0; c < width; c++) {
        let m = Infinity
        for (let n = 1; n <= nDiff; n++) m = Math.min(m, frames[r][c] - frames[r - n][c])
        const v = m > 0 ? m : 0
        diff[r * width + c] = v
        if (v > diffMax) diffMax = v
      }
    }
    if (diffMax > 0) {
      const scale = onsetMax / diffMax
      for (let r = nDiff; r < nFrames; r++) {
        for (let c = 0; c < width; c++) {
          const v = diff[r * width + c] * scale
          if (v > out[r][c]) out[r][c] = v
        }
      }
    }
  }

  breakPlateaus(out, nFrames, width)
  return out
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
