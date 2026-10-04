import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { REQUIRED_CONFIG } from '../config'

const tsx = createRequire(import.meta.url).resolve('tsx/cli')
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !REQUIRED_CONFIG.includes(name as (typeof REQUIRED_CONFIG)[number]))
)
const run = (command: string, task: string, env: NodeJS.ProcessEnv = {}) =>
  execFileSync(process.execPath, [tsx, 'scripts/e2e/regression/cli.ts', command, '--task', task], {
    encoding: 'utf8',
    env: { ...environment, ...env },
    timeout: 20_000,
    stdio: ['ignore', 'pipe', 'pipe']
  })

describe('selected configuration CLI', () => {
  it('preflights local cases without any API or account settings', () => {
    expect(JSON.parse(run('preflight', 'notes'))).toEqual({ task: 'notes', configured: [] })
    expect(JSON.parse(run('preflight', 'provider-model-scroll')).configured).toEqual([])
  })

  it('exports only selected chat settings and never logs credentials', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-config-export-'))
    const file = join(directory, 'github-env')
    try {
      const output = run('export-config', 'custom-provider-chat', {
        GITHUB_ENV: file,
        CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL: 'https://chat.example.test/v1',
        CHERRY_TEST_CUSTOM_PROVIDER_API_KEY: 'chat-secret-test',
        CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL: 'chat-model-test',
        CHERRY_TEST_CHERRYIN_PASSWORD: 'unrelated-secret-test'
      })
      expect(output).not.toContain('secret-test')
      const written = readFileSync(file, 'utf8')
      expect(written).toContain('CHERRY_TEST_CUSTOM_PROVIDER_API_KEY=chat-secret-test\n')
      expect(written).not.toContain('CHERRYIN')
      expect(written).not.toContain('ANTHROPIC')
      expect(written).not.toContain('EMBEDDING')
      expect(() =>
        run('export-config', 'custom-provider-chat', {
          GITHUB_ENV: file,
          CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL: 'https://chat.example.test/v1',
          CHERRY_TEST_CUSTOM_PROVIDER_API_KEY: 'secret\nINJECTED=value',
          CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL: 'chat-model-test'
        })
      ).toThrow('CHERRY_TEST_CUSTOM_PROVIDER_API_KEY must be a single-line value')
      expect(readFileSync(file, 'utf8')).toBe(written)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
