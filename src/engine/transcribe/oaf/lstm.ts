/**
 * Unidirectional LSTM + sigmoid dense head of Onsets and Frames, derived from the Lstm class of Magenta.js
 * (music/src/transcription/model.ts).
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
 * Modified by the Pauta authors (2026): the Keras LSTM cell (sigmoid gates, tanh) written with core ops, input
 * projection computed once per chunk, gates in [i, f, o, c] order, state carried between chunks by the caller. On
 * WebGL each time step is ONE fused shader (recurrent product + gates + new state) instead of about 13 ops: the
 * per-step dispatch overhead, not arithmetic, is what makes the LSTM slow in tfjs.
 */
import * as tf from '@tensorflow/tfjs'
import { LSTM_UNITS } from './constants'

export interface LstmParams {
  /** [inputs, 4 * units], gates [i, f, o, c]. */
  input: tf.Tensor2D
  /** [units, 4 * units]. */
  recurrent: tf.Tensor2D
  /** [4 * units], forget bias included. */
  bias: tf.Tensor1D
  headKernel: tf.Tensor2D
  headBias: tf.Tensor1D
}

export interface LstmState {
  h: tf.Tensor2D
  c: tf.Tensor2D
}

export interface LstmStepper {
  readonly fused: boolean
  initialState(): LstmState
  /** x: [T, inputs] -> sigmoid head outputs [T, 88] and the state after the last step (call inside tf.tidy). */
  run(x: tf.Tensor2D, state: LstmState): { probs: tf.Tensor2D; state: LstmState }
  dispose(): void
}

const U = LSTM_UNITS
const CELL_KERNEL = 'PautaOafLstmCell'
const UNPACK_KERNEL = 'PautaOafUnpack'

/** Turns off the fused WebGL cell (diagnostics / equivalence tests). */
let fusedEnabled = true
export function setFusedLstm(enabled: boolean) {
  fusedEnabled = enabled
}

interface WebGLProgramSpec {
  variableNames: string[]
  outputShape: number[]
  userCode: string
  customUniforms?: { name: string; type: 'int' | 'float' }[]
}

interface WebGLBackendLike {
  runWebGLProgram(program: WebGLProgramSpec, inputs: tf.TensorInfo[], dtype: tf.DataType, uniforms?: number[][]): tf.TensorInfo
}

/** Copies a tensor into an unpacked texture (the cell reads its inputs unpacked; packed inputs would be converted on every step). */
function unpackProgram(shape: number[]): WebGLProgramSpec {
  return {
    variableNames: ['A'],
    outputShape: shape,
    userCode: `void main() { ivec2 rc = getOutputCoords(); setOutput(getA(rc.x, rc.y)); }`,
  }
}

/**
 * One LSTM step for all units: output [1, 2 * units] = [h | c]. Inputs: XW [T, 4u] (x W + b of the chunk), PREV
 * [1, 2u] (previous [h | c]), R [u, 4u]; uniform t picks the row of XW.
 */
function cellProgram(rows: number): WebGLProgramSpec {
  return {
    variableNames: ['XW', 'PREV', 'R'],
    outputShape: [1, 2 * U],
    customUniforms: [{ name: 't', type: 'int' }],
    userCode: `
      float sigm(float x) { return 1.0 / (1.0 + exp(-x)); }
      float tanhf(float x) { float e = exp(-2.0 * abs(x)); float y = (1.0 - e) / (1.0 + e); return x < 0.0 ? -y : y; }
      void main() {
        int j = getOutputCoords().y;
        int u = j < ${U} ? j : j - ${U};
        int row = t < ${rows} ? t : ${rows - 1};
        float zi = getXW(row, u);
        float zf = getXW(row, u + ${U});
        float zo = getXW(row, u + ${2 * U});
        float zc = getXW(row, u + ${3 * U});
        for (int k = 0; k < ${U}; k++) {
          float hk = getPREV(0, k);
          zi += hk * getR(k, u);
          zf += hk * getR(k, u + ${U});
          zo += hk * getR(k, u + ${2 * U});
          zc += hk * getR(k, u + ${3 * U});
        }
        float c = sigm(zf) * getPREV(0, u + ${U}) + sigm(zi) * tanhf(zc);
        setOutput(j < ${U} ? sigm(zo) * tanhf(c) : c);
      }`,
  }
}

function registerKernels() {
  if (!tf.getKernel(UNPACK_KERNEL, 'webgl')) {
    tf.registerKernel({
      kernelName: UNPACK_KERNEL,
      backendName: 'webgl',
      kernelFunc: ({ inputs, backend }) => {
        const x = inputs.x as tf.TensorInfo
        return (backend as unknown as WebGLBackendLike).runWebGLProgram(unpackProgram(x.shape), [x], 'float32')
      },
    })
  }
  if (!tf.getKernel(CELL_KERNEL, 'webgl')) {
    tf.registerKernel({
      kernelName: CELL_KERNEL,
      backendName: 'webgl',
      kernelFunc: ({ inputs, backend, attrs }) => {
        const { xw, prev, r } = inputs as { xw: tf.TensorInfo; prev: tf.TensorInfo; r: tf.TensorInfo }
        const t = (attrs as { t: number }).t
        return (backend as unknown as WebGLBackendLike).runWebGLProgram(cellProgram(xw.shape[0]), [xw, prev, r], 'float32', [[t]])
      },
    })
  }
}

const unpack = (x: tf.Tensor2D) => tf.engine().runKernel(UNPACK_KERNEL, { x }) as tf.Tensor2D

function head(p: LstmParams, h: tf.Tensor2D): tf.Tensor2D {
  return tf.fused.matMul({ a: h, b: p.headKernel, bias: p.headBias, activation: 'sigmoid' }) as tf.Tensor2D
}

function plainStepper(p: LstmParams): LstmStepper {
  return {
    fused: false,
    initialState: () => ({ h: tf.zeros([1, U]) as tf.Tensor2D, c: tf.zeros([1, U]) as tf.Tensor2D }),
    run(x, state) {
      const steps = x.shape[0]
      const xw = tf.add(tf.matMul(x, p.input), p.bias) as tf.Tensor2D
      let { h, c } = state
      const outputs: tf.Tensor2D[] = []
      for (let t = 0; t < steps; t++) {
        const z = tf.fused.matMul({ a: h, b: p.recurrent, bias: tf.slice(xw, [t, 0], [1, 4 * U]) })
        const gates = tf.sigmoid(tf.slice(z, [0, 0], [1, 3 * U]))
        const i = tf.slice(gates, [0, 0], [1, U])
        const f = tf.slice(gates, [0, U], [1, U])
        const o = tf.slice(gates, [0, 2 * U], [1, U])
        c = tf.add(tf.mul(f, c), tf.mul(i, tf.tanh(tf.slice(z, [0, 3 * U], [1, U])))) as tf.Tensor2D
        h = tf.mul(o, tf.tanh(c)) as tf.Tensor2D
        outputs.push(h)
      }
      return { probs: head(p, tf.concat(outputs, 0) as tf.Tensor2D), state: { h, c } }
    },
    dispose() {
      tf.dispose([p.input, p.recurrent, p.bias, p.headKernel, p.headBias])
    },
  }
}

function fusedStepper(p: LstmParams): LstmStepper {
  registerKernels()
  // The recurrent weights stay unpacked on the GPU for the cell shader.
  const recurrent = tf.tidy(() => unpack(p.recurrent))
  return {
    fused: true,
    initialState: () => ({ h: tf.zeros([1, U]) as tf.Tensor2D, c: tf.zeros([1, U]) as tf.Tensor2D }),
    run(x, state) {
      const steps = x.shape[0]
      const xw = unpack(tf.add(tf.matMul(x, p.input), p.bias) as tf.Tensor2D)
      let prev = tf.concat([state.h, state.c], 1) as tf.Tensor2D
      const outputs: tf.Tensor2D[] = []
      for (let t = 0; t < steps; t++) {
        prev = tf.engine().runKernel(CELL_KERNEL, { xw, prev, r: recurrent }, { t } as unknown as tf.NamedAttrMap) as tf.Tensor2D
        outputs.push(prev)
      }
      const hc = tf.concat(outputs, 0) as tf.Tensor2D
      const h = tf.slice(hc, [0, 0], [steps, U]) as tf.Tensor2D
      return {
        probs: head(p, h),
        state: { h: tf.slice(prev, [0, 0], [1, U]) as tf.Tensor2D, c: tf.slice(prev, [0, U], [1, U]) as tf.Tensor2D },
      }
    },
    dispose() {
      tf.dispose([p.input, p.recurrent, p.bias, p.headKernel, p.headBias, recurrent])
    },
  }
}

/** Fused cell on WebGL (unless disabled), plain ops elsewhere. Takes ownership of the parameter tensors. */
export function createLstmStepper(p: LstmParams): LstmStepper {
  return fusedEnabled && tf.getBackend() === 'webgl' ? fusedStepper(p) : plainStepper(p)
}
