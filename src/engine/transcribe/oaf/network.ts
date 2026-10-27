/**
 * Onsets and Frames acoustic model (onsets_frames_uni), derived from Magenta.js (music/src/transcription/model.ts and
 * transcription_utils.ts).
 *
 * @license
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified by the Pauta authors (2026): the same AcousticCnn + Lstm graph and checkpoint layout (gates reordered from
 * the cuDNN-compatible "icfo" layout, forget bias 1), written with core tfjs ops instead of tfjs-layers: BatchNorm
 * folded into the convolutions, fused conv / matMul activations, an LSTM with a fused WebGL cell (lstm.ts). The input
 * is padded to whole chunks (tfjs 3.21 WebGL fails on some uneven last chunks) and processed one chunk at a time with
 * Magenta's context frames (batchInput / unbatchOutput) and the LSTM state carried over, so memory stays flat and
 * progress can be reported per chunk; the outputs are those of OnsetsAndFrames.processBatches, trimmed.
 */
import * as tf from '@tensorflow/tfjs'
import { CHUNK_FRAMES, LSTM_UNITS, MEL_BINS, PITCHES, RF_PAD } from './constants'
import { createLstmStepper, type LstmParams, type LstmState, type LstmStepper } from './lstm'

export type CheckpointWeights = Record<string, tf.Tensor>

const BN_EPSILON = 1e-3
const SCOPES = ['onsets', 'frame', 'velocity'] as const
const LSTM_PREFIX = 'cudnn_lstm/rnn/multi_rnn_cell/cell_0/cudnn_compatible_lstm_cell'
/** 229 mel bins after two [1, 2] max-pools: 57 x 96 channels. */
const FLAT = 57 * 96
const FC_UNITS = 768

interface Conv {
  filter: tf.Tensor4D
  bias: tf.Tensor1D
}

interface Dense {
  kernel: tf.Tensor2D
  bias: tf.Tensor1D
}

interface Cnn {
  conv: [Conv, Conv, Conv]
  fc: Dense
  head?: { dense: Dense; activation: 'sigmoid' | 'linear' }
}

/** Shapes of the checkpoint variables (onsets_frames_uni), used to build a zero-weight skeleton for warm-up. */
export function checkpointShapes(): Record<string, number[]> {
  const shapes: Record<string, number[]> = {}
  for (const scope of SCOPES) {
    const channels = [1, 48, 48, 96]
    for (let k = 0; k < 3; k++) {
      shapes[`${scope}/conv${k}/weights`] = [3, 3, channels[k], channels[k + 1]]
      for (const v of ['beta', 'moving_mean', 'moving_variance']) shapes[`${scope}/conv${k}/BatchNorm/${v}`] = [channels[k + 1]]
    }
    shapes[`${scope}/fc_end/weights`] = [FLAT, FC_UNITS]
    shapes[`${scope}/fc_end/biases`] = [FC_UNITS]
  }
  shapes['frame/activation_probs/weights'] = [FC_UNITS, PITCHES]
  shapes['frame/activation_probs/biases'] = [PITCHES]
  shapes['velocity/onset_velocities/weights'] = [FC_UNITS, PITCHES]
  shapes['velocity/onset_velocities/biases'] = [PITCHES]
  shapes[`onsets/${LSTM_PREFIX}/kernel`] = [FC_UNITS + LSTM_UNITS, 4 * LSTM_UNITS]
  shapes[`onsets/${LSTM_PREFIX}/bias`] = [4 * LSTM_UNITS]
  shapes['onsets/onset_probs/weights'] = [LSTM_UNITS, PITCHES]
  shapes['onsets/onset_probs/biases'] = [PITCHES]
  shapes[`frame/${LSTM_PREFIX}/kernel`] = [2 * PITCHES + LSTM_UNITS, 4 * LSTM_UNITS]
  shapes[`frame/${LSTM_PREFIX}/bias`] = [4 * LSTM_UNITS]
  shapes['frame/frame_probs/weights'] = [LSTM_UNITS, PITCHES]
  shapes['frame/frame_probs/biases'] = [PITCHES]
  return shapes
}

function variable(w: CheckpointWeights, name: string): tf.Tensor {
  const v = w[name]
  if (!v) throw new Error(`Variable not found: ${name}`)
  return v
}

/**
 * Values of a checkpoint variable. Parameters are prepared in plain JS and uploaded once: freshly decoded weights still
 * live on the CPU, so reading them costs nothing, and no intermediate GPU textures (64 MB of raw checkpoint, the
 * folding ops) end up in the WebGL texture pool.
 */
function values(w: CheckpointWeights, name: string): Float32Array {
  return variable(w, name).dataSync() as Float32Array
}

function dense(w: CheckpointWeights, prefix: string): Dense {
  const kernel = variable(w, `${prefix}/weights`)
  return { kernel: tf.tensor2d(values(w, `${prefix}/weights`), kernel.shape as [number, number]), bias: tf.tensor1d(values(w, `${prefix}/biases`)) }
}

/** conv (no bias) -> BatchNorm(scale = false) folded into one conv with bias: W / s, beta - mean / s, s = sqrt(var + eps). */
export function foldedConv(w: CheckpointWeights, prefix: string): Conv {
  const shape = variable(w, `${prefix}/weights`).shape as [number, number, number, number]
  const filter = values(w, `${prefix}/weights`).slice()
  const beta = values(w, `${prefix}/BatchNorm/beta`)
  const mean = values(w, `${prefix}/BatchNorm/moving_mean`)
  const variance = values(w, `${prefix}/BatchNorm/moving_variance`)
  const out = shape[3]
  const inv = new Float32Array(out).map((_, c) => 1 / Math.sqrt(variance[c] + BN_EPSILON))
  for (let i = 0; i < filter.length; i++) filter[i] *= inv[i % out]
  const bias = new Float32Array(out).map((_, c) => beta[c] - mean[c] * inv[c])
  return { filter: tf.tensor4d(filter, shape), bias: tf.tensor1d(bias) }
}

function buildCnn(w: CheckpointWeights, scope: string, head?: { name: string; activation: 'sigmoid' | 'linear' }): Cnn {
  return {
    conv: [foldedConv(w, `${scope}/conv0`), foldedConv(w, `${scope}/conv1`), foldedConv(w, `${scope}/conv2`)],
    fc: dense(w, `${scope}/fc_end`),
    head: head && { dense: dense(w, `${scope}/${head.name}`), activation: head.activation },
  }
}

/** Checkpoint LSTM (cuDNN-compatible "icfo" gates, [x, h] rows) -> kernel / recurrent / bias in [i, f, o, c] order. */
export function buildLstm(w: CheckpointWeights, scope: string, denseName: string): LstmParams {
  const U = LSTM_UNITS
  const rows = variable(w, `${scope}/${LSTM_PREFIX}/kernel`).shape[0]
  const kernel = values(w, `${scope}/${LSTM_PREFIX}/kernel`)
  const bias = values(w, `${scope}/${LSTM_PREFIX}/bias`)
  // Column blocks of the checkpoint: i, c, f, o. Ours: i, f, o, c (sigmoid gates first); forget bias +1 on f.
  const order = [0, 2, 3, 1]
  const reordered = new Float32Array(kernel.length)
  for (let r = 0; r < rows; r++)
    for (let g = 0; g < 4; g++) reordered.set(kernel.subarray(r * 4 * U + order[g] * U, r * 4 * U + (order[g] + 1) * U), r * 4 * U + g * U)
  const b = new Float32Array(4 * U)
  for (let g = 0; g < 4; g++) b.set(bias.subarray(order[g] * U, (order[g] + 1) * U), g * U)
  for (let u = U; u < 2 * U; u++) b[u] += 1.0
  const inputs = rows - U
  const head = dense(w, `${scope}/${denseName}`)
  return {
    input: tf.tensor2d(reordered.subarray(0, inputs * 4 * U), [inputs, 4 * U]),
    recurrent: tf.tensor2d(reordered.subarray(inputs * 4 * U), [U, 4 * U]),
    bias: tf.tensor1d(b),
    headKernel: head.kernel,
    headBias: head.bias,
  }
}

function disposeCnn(cnn: Cnn) {
  for (const c of cnn.conv) tf.dispose([c.filter, c.bias])
  tf.dispose([cnn.fc.kernel, cnn.fc.bias])
  if (cnn.head) tf.dispose([cnn.head.dense.kernel, cnn.head.dense.bias])
}

function runCnn(cnn: Cnn, x: tf.Tensor4D): tf.Tensor2D {
  const [c0, c1, c2] = cnn.conv
  let h = tf.fused.conv2d({ x, filter: c0.filter, strides: 1, pad: 'same', bias: c0.bias, activation: 'relu' })
  h = tf.fused.conv2d({ x: h, filter: c1.filter, strides: 1, pad: 'same', bias: c1.bias, activation: 'relu' })
  h = tf.maxPool(h, [1, 2], [1, 2], 'valid')
  h = tf.fused.conv2d({ x: h, filter: c2.filter, strides: 1, pad: 'same', bias: c2.bias, activation: 'relu' })
  h = tf.maxPool(h, [1, 2], [1, 2], 'valid')
  const [b, t, f, ch] = h.shape
  let out = tf.fused.matMul({ a: tf.reshape(h, [b * t, f * ch]), b: cnn.fc.kernel, bias: cnn.fc.bias, activation: 'relu' }) as tf.Tensor2D
  if (cnn.head) out = tf.fused.matMul({ a: out, b: cnn.head.dense.kernel, bias: cnn.head.dense.bias, activation: cnn.head.activation }) as tf.Tensor2D
  return out
}

/** Model outputs, row-major [frames x 88]: onset and frame probabilities, velocities 10..90 (Magenta's scale). */
export interface Activations {
  frames: number
  onset: Float32Array
  frame: Float32Array
  velocity: Float32Array
}

export interface RunOptions {
  /** Called after each chunk with (chunks done, chunks total). */
  onChunk?: (done: number, total: number) => void
  /** Frames per chunk (default CHUNK_FRAMES): changes memory and speed, not the result. */
  chunkFrames?: number
  /** Called between the stages of each chunk (keeps the client's stall watchdog quiet on slow CPUs). */
  onStep?: () => void
}

export class OafNetwork {
  private onsetsCnn: Cnn
  private frameCnn: Cnn
  private velocityCnn: Cnn
  private onsetsLstm: LstmStepper
  private frameLstm: LstmStepper
  private disposed = false

  constructor(weights: CheckpointWeights) {
    this.onsetsCnn = buildCnn(weights, 'onsets')
    this.frameCnn = buildCnn(weights, 'frame', { name: 'activation_probs', activation: 'sigmoid' })
    this.velocityCnn = buildCnn(weights, 'velocity', { name: 'onset_velocities', activation: 'linear' })
    this.onsetsLstm = createLstmStepper(buildLstm(weights, 'onsets', 'onset_probs'))
    this.frameLstm = createLstmStepper(buildLstm(weights, 'frame', 'frame_probs'))
  }

  /** Same graph with all-zero weights: compiles every shader (warm-up) and times the device without the download. */
  static skeleton(): OafNetwork {
    const zeros: CheckpointWeights = {}
    // CPU-side zero tensors (tf.zeros would fill GPU textures that the parameters never need).
    for (const [name, shape] of Object.entries(checkpointShapes())) zeros[name] = tf.tensor(new Float32Array(shape.reduce((a, b) => a * b, 1)), shape)
    try {
      return new OafNetwork(zeros)
    } finally {
      tf.dispose(Object.values(zeros))
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    disposeCnn(this.onsetsCnn)
    disposeCnn(this.frameCnn)
    disposeCnn(this.velocityCnn)
    this.onsetsLstm.dispose()
    this.frameLstm.dispose()
  }

  /**
   * Runs the model on a log-mel spectrogram ([frames x MEL_BINS], see mel.ts). The frames are padded with the
   * spectrogram's minimum to whole chunks; each chunk's CNN window carries RF_PAD context frames on each side
   * (Magenta's batchInput; at the input's edges, copies of the first frame and the floor), and the LSTM state flows
   * from chunk to chunk, so the result equals running the whole sequence at once (Magenta.js differs only in the
   * first and last 3 frames, where it lets the convolutions pad with 0 dB).
   */
  async run(mel: Float32Array, frames: number, options: RunOptions = {}): Promise<Activations> {
    const chunk = Math.max(16, Math.round(options.chunkFrames ?? CHUNK_FRAMES))
    const total = Math.max(1, Math.ceil(frames / chunk))
    const padded = total * chunk
    const out: Activations = {
      frames,
      onset: new Float32Array(frames * PITCHES),
      frame: new Float32Array(frames * PITCHES),
      velocity: new Float32Array(frames * PITCHES),
    }
    if (!frames) return out
    let floor = Infinity
    for (let i = 0; i < frames * MEL_BINS; i++) if (mel[i] < floor) floor = mel[i]
    // Context rows around the input: RF_PAD copies of the first frame before it, the spectrogram's floor after it (to
    // whole chunks, plus RF_PAD). Every chunk window is then [k * chunk, k * chunk + chunk + 2 * RF_PAD) of these rows
    // and no real frame meets the convolutions' zero padding: a step from 0 dB, or from the floor, into the first
    // frame looks like an attack and produced phantom low notes at 0 s on noisy or abruptly starting audio.
    const rows = padded + 2 * RF_PAD
    const input = new Float32Array(rows * MEL_BINS).fill(floor)
    for (let r = 0; r < RF_PAD; r++) input.set(mel.subarray(0, MEL_BINS), r * MEL_BINS)
    input.set(mel.subarray(0, frames * MEL_BINS), RF_PAD * MEL_BINS)
    const melTensor = tf.tensor2d(input, [rows, MEL_BINS])
    const win = chunk + 2 * RF_PAD
    let onsetState: LstmState = this.onsetsLstm.initialState()
    let frameState: LstmState = this.frameLstm.initialState()
    let pending: { k: number; tensors: tf.Tensor[] } | null = null

    const collect = async (k: number, tensors: tf.Tensor[]) => {
      try {
        const [onset, frame, velocity] = (await Promise.all(tensors.map((t) => t.data()))) as Float32Array[]
        const from = k * chunk
        const count = Math.min(chunk, frames - from)
        if (count > 0) {
          out.onset.set(onset.subarray(0, count * PITCHES), from * PITCHES)
          out.frame.set(frame.subarray(0, count * PITCHES), from * PITCHES)
          for (let i = 0; i < count * PITCHES; i++) {
            // Magenta: clipByValue(v, 0, 1) * 80 + 10, cast to int (float32 arithmetic on the device).
            const v = Math.min(1, Math.max(0, velocity[i]))
            out.velocity[from * PITCHES + i] = Math.trunc(Math.fround(Math.fround(v * 80) + 10))
          }
        }
      } finally {
        tf.dispose(tensors)
      }
      options.onChunk?.(k + 1, total)
    }

    try {
      for (let k = 0; k < total; k++) {
        // The chunk's own frames sit at RF_PAD inside its window (the context of Magenta's batchInput / unbatchOutput).
        const start = k * chunk
        const offset = RF_PAD
        // One scope per network: only one CNN's intermediate buffers (the im2col matrices) exist at a time.
        const step = options.onStep ?? (() => {})
        const x = tf.tidy(() => tf.reshape(tf.slice(melTensor, [start, 0], [win, MEL_BINS]), [1, win, MEL_BINS, 1]) as tf.Tensor4D)
        const own = (cnn: Cnn) => tf.tidy(() => tf.slice(runCnn(cnn, x), [offset, 0], [chunk, -1]) as tf.Tensor2D)
        let onsetFeatures: tf.Tensor2D | null = null
        let activation: tf.Tensor2D | null = null
        let velocity: tf.Tensor2D | null = null
        let result: tf.Tensor2D[]
        try {
          onsetFeatures = own(this.onsetsCnn)
          step()
          activation = own(this.frameCnn)
          step()
          velocity = own(this.velocityCnn)
          step()
          const features = onsetFeatures
          const onsets = tf.tidy(() => {
            const r = this.onsetsLstm.run(features, onsetState)
            return [r.probs, r.state.h, r.state.c]
          }) as tf.Tensor2D[]
          step()
          const act = activation
          const framesOut = tf.tidy(() => {
            const r = this.frameLstm.run(tf.concat([onsets[0], act], 1) as tf.Tensor2D, frameState)
            return [r.probs, r.state.h, r.state.c]
          }) as tf.Tensor2D[]
          result = [onsets[0], framesOut[0], velocity, onsets[1], onsets[2], framesOut[1], framesOut[2]]
          velocity = null
        } finally {
          tf.dispose([x, ...[onsetFeatures, activation, velocity].filter((t): t is tf.Tensor2D => t !== null)])
        }
        tf.dispose([onsetState.h, onsetState.c, frameState.h, frameState.c])
        onsetState = { h: result[3], c: result[4] }
        frameState = { h: result[5], c: result[6] }
        // Read the previous chunk back while the GPU works on this one.
        if (pending) await collect(pending.k, pending.tensors)
        pending = { k, tensors: result.slice(0, 3) }
      }
      if (pending) await collect(pending.k, pending.tensors)
      pending = null
    } finally {
      if (pending) tf.dispose(pending.tensors)
      tf.dispose([melTensor, onsetState.h, onsetState.c, frameState.h, frameState.c])
    }
    return out
  }
}
