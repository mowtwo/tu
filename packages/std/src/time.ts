// M8 Phase 5 — Tu's `Date` replacement, built on TC39 Temporal.
//
// JS `Date` is universally hated: 0-indexed months / 1-indexed days,
// mutable, one type tries to be UTC-instant + civil-time + duration,
// no timezone awareness, underspecified parser. Tu rejects raw
// `new Date()` in user `.tu` source (allowed inside `external JS`
// blocks per the JS-bans rule).
//
// Replacement: re-export `@js-temporal/polyfill`'s namespace under
// Tu-friendly aliases. `Temporal` is TC39 Stage-3 — native browser
// support is rolling out; the polyfill ships native types when the
// platform has them. Bundle weight (~80 KB gzipped) is paid only by
// users who import this submodule.
//
// Usage from Tu:
//   import { now, Instant, ZonedDateTime } from "@tu-lang/std/time"
//
//   let started = now.instant()                    // Instant
//   let later = started.add({ minutes: 5 })
//   let zoned = now.zonedDateTimeISO("Asia/Shanghai")

import { Temporal as TemporalNs } from '@js-temporal/polyfill'

// Value-side re-exports — the static / constructor entry points.
// (TS forbids `export const Foo = SomeNamespaceClass` from re-exporting
// the type at the same identifier; we provide explicit type aliases
// in the next section.)
export const Instant = TemporalNs.Instant
export const ZonedDateTime = TemporalNs.ZonedDateTime
export const PlainDate = TemporalNs.PlainDate
export const PlainTime = TemporalNs.PlainTime
export const PlainDateTime = TemporalNs.PlainDateTime
export const PlainYearMonth = TemporalNs.PlainYearMonth
export const PlainMonthDay = TemporalNs.PlainMonthDay
export const Duration = TemporalNs.Duration
export const Now = TemporalNs.Now

// Sugar: `now` is the most-reached-for entry point (Temporal.Now.* in
// the polyfill); expose under both names so users who skim docs find
// either form.
export const now = TemporalNs.Now

// Type-side aliases — let users import `Instant` (etc.) as a TS TYPE
// for parameter / return annotations.
export type Instant = TemporalNs.Instant
export type ZonedDateTime = TemporalNs.ZonedDateTime
export type PlainDate = TemporalNs.PlainDate
export type PlainTime = TemporalNs.PlainTime
export type PlainDateTime = TemporalNs.PlainDateTime
export type PlainYearMonth = TemporalNs.PlainYearMonth
export type PlainMonthDay = TemporalNs.PlainMonthDay
export type Duration = TemporalNs.Duration

// Re-export the full namespace for power users who want the rest of
// the surface (TimeZone, Calendar, etc.).
export const Temporal = TemporalNs
export type Temporal = typeof TemporalNs
