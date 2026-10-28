import { beforeEach, describe, expect, it } from 'vitest'
import { introMode, pathFromHash, resetIntroForTests, takeIntro } from './introPolicy'

describe('launch intro', () => {
  beforeEach(() => resetIntroForTests())

  it('plays in full when the app opens on a main tab', () => {
    expect(introMode({ played: false, reduced: false, path: '/' })).toBe('full')
    expect(introMode({ played: false, reduced: false, path: '/library' })).toBe('full')
    expect(introMode({ played: false, reduced: false, path: '/settings' })).toBe('full')
  })

  it('plays once per launch, never again on later navigations', () => {
    expect(takeIntro({ reduced: false, path: '/' })).toBe('full')
    expect(takeIntro({ reduced: false, path: '/' })).toBe('none')
    expect(takeIntro({ reduced: false, path: '/library' })).toBe('none')
  })

  it('a new launch (module reset = reload) plays it again', () => {
    expect(takeIntro({ reduced: false, path: '/' })).toBe('full')
    resetIntroForTests()
    expect(takeIntro({ reduced: false, path: '/' })).toBe('full')
  })

  it('is shortened under reduced motion', () => {
    expect(introMode({ played: false, reduced: true, path: '/' })).toBe('short')
  })

  it('never delays a deep link (shared content, a score, the link screen)', () => {
    for (const path of ['/shared', '/link', '/score/abc', '/listen', '/processing', '/import', '/about']) {
      expect(introMode({ played: false, reduced: false, path })).toBe('none')
    }
    // ...and the decision is still spent: going to Home afterwards does not play it.
    expect(takeIntro({ reduced: false, path: '/score/abc' })).toBe('none')
    expect(takeIntro({ reduced: false, path: '/' })).toBe('none')
  })

  it('automated browsers skip it unless forced', () => {
    expect(introMode({ played: false, reduced: false, path: '/', automated: true })).toBe('none')
    expect(introMode({ played: false, reduced: false, path: '/', automated: true, forced: true })).toBe('full')
    expect(introMode({ played: false, reduced: true, path: '/score/x', forced: true })).toBe('short')
    expect(introMode({ played: true, reduced: false, path: '/', forced: true })).toBe('none')
  })

  it('reads the route from the hash', () => {
    expect(pathFromHash('')).toBe('/')
    expect(pathFromHash('#/')).toBe('/')
    expect(pathFromHash('#/library?view=grid')).toBe('/library')
    expect(pathFromHash('#/score/abc')).toBe('/score/abc')
    expect(pathFromHash('#settings')).toBe('/settings')
  })
})
