import type { App } from 'obsidian';
import {
  OG_CHIPS_EDITOR_TYPE,
  OG_TEXT_EDITOR_TYPE,
  type ChipsEditorConfig,
  type SvarEditorConfig,
  type TextEditorConfig,
} from './cellEditCommit';
import type { FileFilterConfig } from './fileFilter';
import { normalizeStoredList } from './taskNotesSuggest';
import { createVaultWikilinkFetcher } from './vaultWikilinkSuggest';

interface ChipsOpenWiring {
  readRawSeed: () => unknown;
  commitRawList: (raw: string[]) => void;
}

export interface SvarCellEditorOpenContext {
  app: App;
  sourcePath: string;
  chips?: ChipsOpenWiring;
}

export function wireSvarCellEditorForOpen(
  config: SvarEditorConfig,
  context: SvarCellEditorOpenContext,
): SvarEditorConfig {
  if (typeof config === 'string') return config;
  if (config.type === OG_TEXT_EDITOR_TYPE) {
    const editorConfig = config.config as TextEditorConfig;
    const filter = editorConfig.autosuggestFilter as FileFilterConfig | undefined;
    return {
      type: OG_TEXT_EDITOR_TYPE,
      config: {
        fetchSuggestions: createVaultWikilinkFetcher(context.app, context.sourcePath, filter),
      },
    };
  }
  if (config.type !== OG_CHIPS_EDITOR_TYPE || !context.chips) return config;
  const editorConfig = config.config as ChipsEditorConfig;
  const filter = editorConfig.autosuggestFilter as FileFilterConfig | undefined;
  return {
    type: OG_CHIPS_EDITOR_TYPE,
    config: {
      fetchSuggestions: createVaultWikilinkFetcher(context.app, context.sourcePath, filter),
      seed: normalizeStoredList(context.chips.readRawSeed()),
      commitList: context.chips.commitRawList,
    },
  };
}
