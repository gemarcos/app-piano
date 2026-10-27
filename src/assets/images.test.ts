import { describe, expect, it } from 'vitest'
import { covers, getCover, pickCoverId } from './images'

describe('pickCoverId', () => {
  it('is deterministic and returns a known cover', () => {
    const id = pickCoverId('item-123')
    expect(id).toBe(pickCoverId('item-123'))
    expect(getCover(id)).toBeDefined()
  })

  it('skips covers in use and keeps the plain choice when nothing is avoided', () => {
    const plain = pickCoverId('item-123')
    expect(pickCoverId('item-123', [])).toBe(plain)
    const other = pickCoverId('item-123', [plain])
    expect(other).not.toBe(plain)
    expect(getCover(other)).toBeDefined()
    const used = covers.slice(0, covers.length - 1).map((c) => c.id)
    expect(pickCoverId('item-123', used)).toBe(covers[covers.length - 1].id)
  })

  it('falls back to the plain choice when every cover is in use', () => {
    expect(pickCoverId('item-123', covers.map((c) => c.id))).toBe(pickCoverId('item-123'))
  })
})
