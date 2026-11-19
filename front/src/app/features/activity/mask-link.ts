/** Shown in place of the hidden part of a secret link. */
const HIDDEN = '••••';

/**
 * Hide the secret parts of a link: keep scheme and host, drop credentials, path and query.
 *
 * @param link - Link as stored (http, https or webcal).
 * @returns "scheme://host/••••", or "••••" when the link does not parse.
 */
export function maskLink(link: string): string {
  try {
    const url = new URL(link.trim());
    return url.host ? `${url.protocol}//${url.host}/${HIDDEN}` : HIDDEN;
  } catch {
    return HIDDEN;
  }
}

/**
 * Mask every non-blank line of a multi-link setting.
 *
 * @param text - One link per line.
 * @returns Masked links.
 */
export function maskLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(maskLink);
}
