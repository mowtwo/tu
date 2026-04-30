export const VERSION = '0.0.0'
export const SERVER_NAME = '@tu-ui/lsp'

export { checkTuFile, checkTuSource, type TuDiagnostic } from './diagnostics.js'
export { completionsAtTuPosition, type TuCompletionItem } from './completion.js'
export { definitionAtTuPosition, type TuDefinition } from './definition.js'
export { hoverAtTuFile, hoverAtTuPosition, type TuHover } from './hover.js'
export { renameAtTuPosition, type TuRenameEdit } from './rename.js'
export {
  buildSourceMapper,
  decodeMappings,
  mapSourceLineColToTS,
  mapToSource,
  mapTSRangeToSource,
  type MappingSegment,
} from './source-map.js'
