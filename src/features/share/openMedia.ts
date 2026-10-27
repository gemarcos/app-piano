// Owner: share. Puts a shared or picked media file into the capture flow, like Home's "Archivo":
// size check -> decodeMediaFile -> capture store (default trim selection). The caller then opens /import.
import { decodeMediaFile } from '../../engine/audio'
import { defaultSelection } from '../capture/selection'
import { useCaptureStore } from '../capture/store'
import { INTAKE_MESSAGES, MAX_SHARED_FILE_BYTES } from './intake'

/** Rejects with a Spanish message: INTAKE_MESSAGES.tooBig, or the engine's DECODE_ERROR_MESSAGE. */
export async function openMediaFile(file: File): Promise<void> {
  if (file.size > MAX_SHARED_FILE_BYTES) {
    const error = new Error(INTAKE_MESSAGES.tooBig)
    error.name = 'FileTooLargeError'
    throw error
  }
  const decoded = await decodeMediaFile(file)
  useCaptureStore.getState().setFile(file, decoded, defaultSelection(decoded.duration))
}
