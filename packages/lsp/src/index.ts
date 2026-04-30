export const VERSION = '0.0.0'
export const SERVER_NAME = '@tu/lsp'

export { checkTuFile, checkTuSource, type TuDiagnostic } from './diagnostics.js'
export {
  buildSourceMapper,
  decodeMappings,
  mapToSource,
  type MappingSegment,
} from './source-map.js'
