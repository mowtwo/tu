export const VERSION = '0.0.0'
export const SERVER_NAME = '@tu/lsp'

export { checkTuFile, checkTuSource, type TuDiagnostic } from './diagnostics.js'
export { hoverAtTuFile, hoverAtTuPosition, type TuHover } from './hover.js'
export {
  buildSourceMapper,
  decodeMappings,
  mapSourceLineColToTS,
  mapToSource,
  mapTSRangeToSource,
  type MappingSegment,
} from './source-map.js'
