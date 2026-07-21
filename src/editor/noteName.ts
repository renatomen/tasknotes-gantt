/**
 * Pure helpers for renaming a calendar note from the editor. The note's name is
 * its filename, not frontmatter, so this lives apart from the frontmatter form
 * state: validate a proposed name and compute the target path within the same
 * folder. The view performs the actual rename through Obsidian's file manager.
 *
 * @module editor/noteName
 */

/** Characters Obsidian forbids in a note name (path separators + reserved). */
const ILLEGAL_NAME = /[\\/:*?"<>|]/;

/**
 * The basename (no folder, no `.md`) of a vault path — what the editor shows and
 * lets the user rename. `''` for a null path or an empty basename.
 */
export function noteBasename(path: string | null): string {
  if (!path) return '';
  const file = path.slice(path.lastIndexOf('/') + 1);
  return file.endsWith('.md') ? file.slice(0, -'.md'.length) : file;
}

/** A validation error for a proposed name, or null when it is usable. */
export function validateNoteName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Name cannot be empty';
  if (ILLEGAL_NAME.test(trimmed)) return 'Name cannot contain \\ / : * ? " < > |';
  return null;
}

/** The rename target: the new name as a `.md` file in the note's own folder. */
export function renameTargetPath(currentPath: string, newName: string): string {
  const slash = currentPath.lastIndexOf('/');
  const folder = slash === -1 ? '' : currentPath.slice(0, slash + 1);
  return `${folder}${newName.trim()}.md`;
}
