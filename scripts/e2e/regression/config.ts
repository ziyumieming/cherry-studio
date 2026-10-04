import { type CaseId, REGRESSION_CASES } from './cases'

export const REQUIRED_CONFIG = [
  'CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL',
  'CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL',
  'CHERRY_TEST_CUSTOM_PROVIDER_API_KEY',
  'CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL',
  'CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL',
  'CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_API_KEY',
  'CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL',
  'CHERRY_TEST_CHERRYIN_CHAT_MODEL',
  'CHERRY_TEST_CHERRYIN_IMAGE_MODEL',
  'CHERRY_TEST_CHERRYIN_ACCOUNT',
  'CHERRY_TEST_CHERRYIN_PASSWORD'
] as const

export type RequiredConfigName = (typeof REQUIRED_CONFIG)[number]

export interface RegressionTestConfig {
  customProvider: {
    baseUrl: string
    anthropicBaseUrl: string
    apiKey: string
    chatModel: string
  }
  customEmbeddingProvider: {
    baseUrl: string
    apiKey: string
    model: string
  }
  cherryIn: {
    chatModel: string
    imageModel: string
    account: string
    password: string
  }
}

type Environment = Record<string, string | undefined>

const CHAT_CONFIG = [
  'CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL',
  'CHERRY_TEST_CUSTOM_PROVIDER_API_KEY',
  'CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL'
] as const
const ANTHROPIC_CONFIG = [...CHAT_CONFIG, 'CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL'] as const
const EMBEDDING_CONFIG = [
  'CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL',
  'CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_API_KEY',
  'CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL'
] as const
const ACCOUNT_CONFIG = ['CHERRY_TEST_CHERRYIN_ACCOUNT', 'CHERRY_TEST_CHERRYIN_PASSWORD'] as const

const CASE_CONFIG: Record<CaseId, readonly RequiredConfigName[]> = {
  'S-01': [],
  'APP-01': [],
  'N-01': [],
  'M-03': [],
  'M-02': CHAT_CONFIG,
  'C-01': CHAT_CONFIG,
  'T-01': CHAT_CONFIG,
  'T-02': CHAT_CONFIG,
  'C-02': CHAT_CONFIG,
  'K-01': [...CHAT_CONFIG, ...EMBEDDING_CONFIG],
  'MCP-01': CHAT_CONFIG,
  'A-02': CHAT_CONFIG,
  'CODE-01': ANTHROPIC_CONFIG,
  'CODE-02': CHAT_CONFIG,
  'CODE-03': CHAT_CONFIG,
  'M-01': [...ACCOUNT_CONFIG, 'CHERRY_TEST_CHERRYIN_CHAT_MODEL'],
  'P-01': [...ACCOUNT_CONFIG, 'CHERRY_TEST_CHERRYIN_IMAGE_MODEL'],
  'A-03': ANTHROPIC_CONFIG,
  'A-04': CHAT_CONFIG,
  'A-05': CHAT_CONFIG,
  'A-01': CHAT_CONFIG
}

export function requiredConfigForCases(caseIds: readonly CaseId[]): RequiredConfigName[] {
  const required = new Set(caseIds.flatMap((id) => CASE_CONFIG[id]))
  return REQUIRED_CONFIG.filter((name) => required.has(name))
}

export function loadTestConfig(
  environment: Environment = process.env,
  caseIds: readonly CaseId[] = REGRESSION_CASES.map(({ id }) => id)
): RegressionTestConfig {
  const required = requiredConfigForCases(caseIds)
  const missing = required.filter((name) => !environment[name]?.trim())
  if (missing.length > 0) {
    throw new Error(`Missing regression test configuration: ${missing.join(', ')}`)
  }

  const value = (name: RequiredConfigName) => environment[name]?.trim() ?? ''
  const absoluteUrl = (name: RequiredConfigName) => {
    const result = value(name)
    if (!required.includes(name)) return result
    try {
      new URL(result)
      return result
    } catch {
      throw new Error(`${name} must be an absolute URL`)
    }
  }

  return {
    customProvider: {
      baseUrl: absoluteUrl('CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL'),
      anthropicBaseUrl: absoluteUrl('CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL'),
      apiKey: value('CHERRY_TEST_CUSTOM_PROVIDER_API_KEY'),
      chatModel: value('CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL')
    },
    customEmbeddingProvider: {
      baseUrl: absoluteUrl('CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL'),
      apiKey: value('CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_API_KEY'),
      model: value('CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL')
    },
    cherryIn: {
      chatModel: value('CHERRY_TEST_CHERRYIN_CHAT_MODEL'),
      imageModel: value('CHERRY_TEST_CHERRYIN_IMAGE_MODEL'),
      account: value('CHERRY_TEST_CHERRYIN_ACCOUNT'),
      password: value('CHERRY_TEST_CHERRYIN_PASSWORD')
    }
  }
}

export function getSensitiveConfigValues(config: RegressionTestConfig): string[] {
  return [
    config.customProvider.apiKey,
    config.customEmbeddingProvider.apiKey,
    config.cherryIn.account,
    config.cherryIn.password
  ].filter(Boolean)
}
