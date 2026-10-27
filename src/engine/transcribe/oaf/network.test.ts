// The vendored Onsets and Frames graph on the tfjs CPU backend (Node): checkpoint layout handling, chunking, shipped
// manifest. The browser equivalence with Magenta.js itself is checked on WebGL (outputs within ~1e-6, see the report).
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as tf from '@tensorflow/tfjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { LSTM_UNITS, MEL_BINS, PITCHES } from './constants'
import { createLstmStepper } from './lstm'
import { buildLstm, checkpointShapes, foldedConv, OafNetwork, type CheckpointWeights } from './network'
import { manifestBytes } from './weights'

const LSTM_PREFIX = 'cudnn_lstm/rnn/multi_rnn_cell/cell_0/cudnn_compatible_lstm_cell'

function lcg(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647 - 0.5
  }
}

function randomArray(n: number, scale: number, rand: () => number, offset = 0): Float32Array {
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = offset + scale * rand()
  return a
}

/** Random checkpoint with plausible scales (positive BatchNorm variances). */
function randomCheckpoint(seed: number): CheckpointWeights {
  const rand = lcg(seed)
  const w: CheckpointWeights = {}
  for (const [name, shape] of Object.entries(checkpointShapes())) {
    const n = shape.reduce((a, b) => a * b, 1)
    const fanIn = shape.length > 1 ? shape.slice(0, -1).reduce((a, b) => a * b, 1) : 1
    const values = name.endsWith('moving_variance')
      ? randomArray(n, 0.8, rand, 1)
      : name.endsWith('moving_mean') || name.endsWith('beta')
        ? randomArray(n, 0.2, rand)
        : shape.length > 1
          ? randomArray(n, 2.5 / Math.sqrt(fanIn), rand)
          : randomArray(n, 0.1, rand)
    w[name] = tf.tensor(values, shape)
  }
  return w
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

beforeAll(async () => {
  await tf.setBackend('cpu')
  await tf.ready()
})

describe('Onsets and Frames network (vendored)', () => {
  it('folds BatchNorm (scale = false, eps 1e-3) into the convolution exactly', () => {
    const rand = lcg(3)
    const w: CheckpointWeights = {
      'x/weights': tf.tensor(randomArray(3 * 3 * 2 * 4, 1, rand), [3, 3, 2, 4]),
      'x/BatchNorm/beta': tf.tensor(randomArray(4, 1, rand)),
      'x/BatchNorm/moving_mean': tf.tensor(randomArray(4, 1, rand)),
      'x/BatchNorm/moving_variance': tf.tensor(randomArray(4, 0.5, rand, 1)),
    }
    const x = tf.tensor(randomArray(5 * 7 * 2, 2, rand), [1, 5, 7, 2]) as tf.Tensor4D
    const reference = tf.relu(
      tf.add(
        tf.div(tf.sub(tf.conv2d(x, w['x/weights'] as tf.Tensor4D, 1, 'same'), w['x/BatchNorm/moving_mean']), tf.sqrt(tf.add(w['x/BatchNorm/moving_variance'], 1e-3))),
        w['x/BatchNorm/beta'],
      ),
    )
    const conv = foldedConv(w, 'x')
    const folded = tf.fused.conv2d({ x, filter: conv.filter, strides: 1, pad: 'same', bias: conv.bias, activation: 'relu' })
    expect(tf.max(tf.abs(tf.sub(reference, folded))).dataSync()[0]).toBeLessThan(1e-5)
  })

  it('reads the cuDNN-compatible LSTM ("icfo" gates, [x, h] rows, forget bias 1) like Magenta.js', () => {
    const rand = lcg(11)
    const inputs = 8
    const steps = 5
    const U = LSTM_UNITS
    const kernel = randomArray((inputs + U) * 4 * U, 0.2, rand)
    const bias = randomArray(4 * U, 0.2, rand)
    const headW = randomArray(U * PITCHES, 0.2, rand)
    const headB = randomArray(PITCHES, 0.2, rand)
    const w: CheckpointWeights = {
      [`s/${LSTM_PREFIX}/kernel`]: tf.tensor(kernel, [inputs + U, 4 * U]),
      [`s/${LSTM_PREFIX}/bias`]: tf.tensor(bias, [4 * U]),
      's/head/weights': tf.tensor(headW, [U, PITCHES]),
      's/head/biases': tf.tensor(headB, [PITCHES]),
    }
    const x = randomArray(steps * inputs, 2, rand)
    // Naive cell: z = [x, h] K + b; i, c~, f, o in the checkpoint's column order; f gets +1.
    let h = new Float64Array(U)
    let c = new Float64Array(U)
    const expected: number[] = []
    for (let t = 0; t < steps; t++) {
      const z = new Float64Array(4 * U)
      for (let col = 0; col < 4 * U; col++) {
        let acc = bias[col]
        for (let r = 0; r < inputs; r++) acc += x[t * inputs + r] * kernel[r * 4 * U + col]
        for (let r = 0; r < U; r++) acc += h[r] * kernel[(inputs + r) * 4 * U + col]
        z[col] = acc
      }
      const nh = new Float64Array(U)
      const nc = new Float64Array(U)
      for (let u = 0; u < U; u++) {
        const i = sigmoid(z[u])
        const g = Math.tanh(z[U + u])
        const f = sigmoid(z[2 * U + u] + 1)
        const o = sigmoid(z[3 * U + u])
        nc[u] = f * c[u] + i * g
        nh[u] = o * Math.tanh(nc[u])
      }
      h = nh
      c = nc
      for (let p = 0; p < PITCHES; p++) {
        let acc = headB[p]
        for (let u = 0; u < U; u++) acc += h[u] * headW[u * PITCHES + p]
        expected.push(sigmoid(acc))
      }
    }
    const stepper = createLstmStepper(buildLstm(w, 's', 'head'))
    expect(stepper.fused).toBe(false)
    // Two chunks with the state carried must equal one pass.
    const state0 = stepper.initialState()
    const first = stepper.run(tf.tensor2d(x.subarray(0, 2 * inputs), [2, inputs]), state0)
    const second = stepper.run(tf.tensor2d(x.subarray(2 * inputs), [steps - 2, inputs]), first.state)
    const got = [...first.probs.dataSync(), ...second.probs.dataSync()]
    let max = 0
    got.forEach((v, i) => (max = Math.max(max, Math.abs(v - expected[i]))))
    expect(max).toBeLessThan(1e-5)
    const finalH = second.state.h.dataSync()
    expect(Math.abs(finalH[7] - h[7])).toBeLessThan(1e-5)
    stepper.dispose()
  })

  it('gives the same outputs whatever the chunk size (context frames, LSTM state across chunks)', async () => {
    const weights = randomCheckpoint(5)
    const net = new OafNetwork(weights)
    tf.dispose(Object.values(weights))
    const frames = 18
    const rand = lcg(9)
    const mel = randomArray(frames * MEL_BINS, 60, rand, -50)
    const a = await net.run(mel, frames, { chunkFrames: 16 })
    const b = await net.run(mel, frames, { chunkFrames: 32 })
    net.dispose()
    const diff = (x: Float32Array, y: Float32Array) => x.reduce((m, v, i) => Math.max(m, Math.abs(v - y[i])), 0)
    expect(a.onset.length).toBe(frames * PITCHES)
    // Every frame of chunk 2 sees its full context in both runs; only the padded tail beyond frame 18 differs.
    expect(diff(a.onset, b.onset)).toBeLessThan(2e-4)
    expect(diff(a.frame, b.frame)).toBeLessThan(2e-4)
    expect(diff(a.velocity, b.velocity)).toBeLessThanOrEqual(1)
    const spread = a.onset.reduce((m, v) => Math.max(m, v), 0) - a.onset.reduce((m, v) => Math.min(m, v), 1)
    expect(spread).toBeGreaterThan(0.01) // random weights produce varied outputs, so the comparison means something
  }, 120_000)

  it('runs the zero-weight skeleton (warm-up and speed probe before any download)', async () => {
    const before = tf.memory().numTensors
    const net = OafNetwork.skeleton()
    const out = await net.run(new Float32Array(16 * MEL_BINS).fill(-100), 16, { chunkFrames: 16 })
    net.dispose()
    expect(out.onset.every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true) // sigmoid(0)
    expect(out.velocity.every((v) => v === 10)).toBe(true) // Magenta: clip(0) * 80 + 10
    expect(tf.memory().numTensors).toBe(before) // nothing leaks
  }, 120_000)

  it('ships a checkpoint whose manifest matches the graph and its shard files', () => {
    const dir = fileURLToPath(new URL('../../../../public/models/onsets-frames/', import.meta.url))
    const [group] = JSON.parse(readFileSync(path.join(dir, 'weights_manifest.json'), 'utf8')) as {
      paths: string[]
      weights: { name: string; shape: number[]; dtype: string; quantization?: { dtype: string } }[]
    }[]
    const shapes = checkpointShapes()
    expect(Object.keys(shapes).sort()).toEqual(group.weights.map((w) => w.name).sort())
    for (const w of group.weights) expect(w.shape).toEqual(shapes[w.name])
    const bytes = group.paths.reduce((s, p) => s + statSync(path.join(dir, p)).size, 0)
    expect(manifestBytes(group.weights as tf.io.WeightsManifestEntry[])).toBe(bytes)
    expect(bytes).toBeLessThan(17 * 1024 * 1024)
    const kinds = new Set(group.weights.map((w) => w.quantization?.dtype ?? 'float32'))
    expect([...kinds].sort()).toEqual(['float32', 'uint16', 'uint8'])
  })
})
