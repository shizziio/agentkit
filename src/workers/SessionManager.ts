import { randomBytes } from 'node:crypto';

/**
 * Generate a deterministic session name for a new stage execution.
 * Format: {PROJECT}-{STORY_KEY}-{STAGE}-{RANDOM_8}
 * Example: AGENTKIT-20.3-DEV-abc12345
 */
export function generateSessionName(
  projectName: string,
  storyKey: string,
  stageName: string,
): string {
  const proj = projectName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const story = storyKey.replace(/[^a-zA-Z0-9.\-]/g, '');
  const stage = stageName.toUpperCase();
  const rand = randomBytes(4).toString('hex');
  return `${proj}-${story}-${stage}-${rand}`;
}

/**
 * Determine if a task execution should resume an existing session.
 * Both conditions must be true:
 * 1. Provider supports sessions
 * 2. Existing session name exists for this stage (stored in stories.session_info)
 *
 * This covers two re-entry paths:
 * - Retry after reject (attempt > 1, same stage)
 * - Forward routing back to a previously-visited stage (e.g. review → tester → review)
 */
export function isResumable(
  _attempt: number,
  sessionSupport: boolean,
  existingSession: string | null,
): boolean {
  return sessionSupport && existingSession != null;
}

/**
 * Parse session_info JSON from story record.
 * Returns empty object for null/invalid values.
 */
export function parseSessionInfo(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch { /* invalid JSON */ }
  return {};
}
