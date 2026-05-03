import { describe, expect, it } from 'vitest'
import { is, preloadTemporal, type } from '../src/index.js'
import {
  Instant,
  PlainDate,
  PlainDateTime,
  Duration,
  Temporal,
  ZonedDateTime,
  now,
} from '../src/time.js'

describe('@tu-lang/std/time — Temporal re-exports', () => {
  it('exposes the core Temporal value-side classes', () => {
    expect(typeof Instant).toBe('function')
    expect(typeof ZonedDateTime).toBe('function')
    expect(typeof PlainDate).toBe('function')
    expect(typeof PlainDateTime).toBe('function')
    expect(typeof Duration).toBe('function')
  })

  it('`now` provides the standard Temporal.Now entry points', () => {
    expect(typeof now.instant).toBe('function')
    expect(typeof now.zonedDateTimeISO).toBe('function')
    expect(typeof now.plainDateISO).toBe('function')
  })

  it('Instant.fromEpochMilliseconds round-trips through epochMilliseconds', () => {
    const inst = Instant.fromEpochMilliseconds(1700000000000)
    expect(Number(inst.epochMilliseconds)).toBe(1700000000000)
  })

  it('PlainDate construction is 1-indexed (the JS Date fix)', () => {
    const d = PlainDate.from('2026-05-03')
    expect(d.year).toBe(2026)
    expect(d.month).toBe(5) // May = 5, not 4 (the JS Date footgun fixed)
    expect(d.day).toBe(3)
  })

  it('Duration.add returns a NEW duration (immutability)', () => {
    const a = Duration.from({ minutes: 5 })
    const b = a.add({ seconds: 30 })
    expect(a.minutes).toBe(5)
    expect(b.minutes).toBe(5)
    expect(b.seconds).toBe(30)
  })

  it('namespace re-export `Temporal` works for advanced users', () => {
    expect(Temporal.Instant).toBe(Instant)
    expect(Temporal.Now).toBe(now)
  })
})

describe('@tu-lang/std/type — Temporal descriptors (Phase 5)', () => {
  it('type.is recognizes Temporal.Instant via constructor-name fast path', async () => {
    const inst = Instant.fromEpochMilliseconds(0)
    // First call before preload — relies on constructor-name match.
    expect(is(inst, type.Instant)).toBe(true)
    expect(is(42, type.Instant)).toBe(false)
    expect(is({}, type.Instant)).toBe(false)
  })

  it('type.is recognizes Temporal.PlainDate, ZonedDateTime, Duration', () => {
    expect(is(PlainDate.from('2026-05-03'), type.PlainDate)).toBe(true)
    expect(is(now.zonedDateTimeISO('UTC'), type.ZonedDateTime)).toBe(true)
    expect(is(Duration.from({ hours: 1 }), type.Duration)).toBe(true)

    // Wrong-type cross-check: a PlainDate is NOT an Instant.
    expect(is(PlainDate.from('2026-05-03'), type.Instant)).toBe(false)
  })

  it('preloadTemporal resolves the polyfill so subsequent checks use real instanceof', async () => {
    await preloadTemporal()
    const inst = Instant.fromEpochMilliseconds(0)
    expect(is(inst, type.Instant)).toBe(true)
    // After preload, descriptor's `check` does the strict instanceof
    // path. Construct a fake object with the right constructor name
    // to verify the strict check rejects spoofs.
    class FakeInstant {}
    Object.defineProperty(FakeInstant, 'name', { value: 'Instant' })
    const fake = new FakeInstant()
    // Pre-preload, this would pass via constructor-name match. Post-
    // preload, the polyfill's strict instanceof rejects it.
    expect(is(fake, type.Instant)).toBe(false)
  })
})
