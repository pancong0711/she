/** Pure helpers for displaying task reports in the PWA chat. */

/**
 * Remove the deterministic SHE report header so the chat shows the agent's
 * answer rather than file metadata. Unknown/empty reports are returned as-is
 * after trimming.
 */
export function extractAgentReportText(markdown: string): string {
  const normalized = String(markdown ?? '').replace(/\r\n/g, '\n')
  const header = /^# SHE task report\n\n(?:- [^\n]*\n)+\n?/
  return normalized.replace(header, '').trim()
}
