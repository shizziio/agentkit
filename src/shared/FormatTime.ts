/**
 * Shared time-formatting utilities.
 * DB stores UTC ISO 8601; these helpers convert to local-timezone display strings.
 */

/**
 * Converts a UTC ISO 8601 string to HH:mm:ss in the machine's local timezone.
 * Returns '--:--:--' for invalid or empty input.
 */
export function formatLocalTime(isoUtc: string): string {
  if (!isoUtc) return '--:--:--';
  const d = new Date(isoUtc);
  if (isNaN(d.getTime())) return '--:--:--';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Converts a Unix timestamp (milliseconds) to HH:mm:ss in the machine's local timezone.
 * Avoids the UTC ISO round-trip when the source is already a numeric timestamp.
 */
export function formatLocalTimeMs(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Converts a UTC ISO 8601 string to YYYY-MM-DD HH:mm:ss in the machine's local timezone.
 * Returns '---- -- -- --:--:--' for invalid or empty input.
 */
export function formatLocalDateTime(isoUtc: string): string {
  if (!isoUtc) return '---- -- -- --:--:--';
  const d = new Date(isoUtc);
  if (isNaN(d.getTime())) return '---- -- -- --:--:--';
  const year = String(d.getFullYear()).padStart(4, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${h}:${m}:${s}`;
}
