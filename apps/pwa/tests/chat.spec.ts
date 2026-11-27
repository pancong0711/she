import { describe, expect, it } from 'vitest'
import { extractAgentReportText } from '../src/chat'

describe('extractAgentReportText', () => {
  it('removes the SHE report header and keeps the agent answer', () => {
    const markdown = [
      '# SHE task report',
      '',
      '- task: task-000001',
      '- topic: topic-000001',
      '- generated: 2026-11-27T00:00:00.000Z',
      '',
      'worker-ok',
    ].join('\n')
    expect(extractAgentReportText(markdown)).toBe('worker-ok')
  })

  it('keeps non-report markdown unchanged', () => {
    expect(extractAgentReportText('plain answer\n')).toBe('plain answer')
  })
})
