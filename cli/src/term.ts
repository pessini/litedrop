// Server-supplied text (error details, slugs, filenames, URLs) is printed to
// the terminal. Strip control characters — C0 except tab/newline, DEL, and the
// C1 range — so a hostile response can't inject escape sequences. JSON output
// doesn't need this: JSON.stringify already escapes control characters.
const CONTROL_CHARS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;

export function stripControl(text: string): string {
  return text.replace(CONTROL_CHARS, "");
}
