export const VERSION = '0.0.0'

/**
 * `@tu-lang/std` — Tu's standard library. M8 Phase 1 ships the type
 * metadata system (interface descriptors + `type.of` / `type.is`); more
 * modules (Result/Option, iterators, formatters) follow as the language
 * needs them.
 */
export const STD_NAME = '@tu-lang/std'

export {
  type,
  of,
  is,
  as,
  tryFrom,
  tag,
  struct,
  native,
  Array_,
  Optional,
  TypeMismatchError,
  preloadTemporal,
} from './type.js'
export type { TypeDescriptor, TypeKind, StructField, TypeTryFromResult } from './type.js'
