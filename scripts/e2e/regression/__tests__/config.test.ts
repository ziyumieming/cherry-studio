import { getSensitiveConfigValues, loadTestConfig } from '../config'

describe('regression test configuration', () => {
  const validEnv = {
    CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL: 'https://gateway.example.test/v1',
    CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL: ' https://anthropic.example.test ',
    CHERRY_TEST_CUSTOM_PROVIDER_API_KEY: 'provider-secret',
    CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL: 'Qwen/Qwen3.6-27B',
    CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL: 'https://embedding.example.test/v1',
    CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_API_KEY: 'embedding-secret',
    CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL: 'text-embedding-test',
    CHERRY_TEST_CHERRYIN_CHAT_MODEL: 'cherry-chat-test',
    CHERRY_TEST_CHERRYIN_IMAGE_MODEL: 'image-test',
    CHERRY_TEST_CHERRYIN_ACCOUNT: 'automation@example.test',
    CHERRY_TEST_CHERRYIN_PASSWORD: 'account-secret'
  }

  it('requires a separate Anthropic URL instead of reusing the OpenAI URL', () => {
    expect(() => loadTestConfig({ ...validEnv, CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL: undefined })).toThrow(
      'Missing regression test configuration: CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL'
    )
  })

  it.each(['S-01', 'N-01', 'M-03', 'SG-02'] as const)('runs local %s without service credentials', (id) => {
    expect(() => loadTestConfig({}, [id])).not.toThrow()
  })

  it('requires only OpenAI chat configuration for a custom-provider chat', () => {
    const chat = {
      CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL: validEnv.CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL,
      CHERRY_TEST_CUSTOM_PROVIDER_API_KEY: validEnv.CHERRY_TEST_CUSTOM_PROVIDER_API_KEY,
      CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL: validEnv.CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL
    }
    expect(loadTestConfig(chat, ['M-02']).customProvider.chatModel).toBe(chat.CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL)
    expect(() => loadTestConfig({ ...chat, CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL: undefined }, ['M-02'])).toThrow(
      'CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL'
    )
    expect(loadTestConfig(chat, ['SG-01']).customProvider.chatModel).toBe(chat.CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL)
    expect(() => loadTestConfig(chat, ['CODE-01'])).toThrow('CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL')
  })

  it('requires real embedding and account settings only for their selected scenarios', () => {
    expect(() => loadTestConfig({}, ['K-01'])).toThrow('CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL')
    expect(() => loadTestConfig({}, ['M-01'])).toThrow('CHERRY_TEST_CHERRYIN_ACCOUNT')
    expect(() => loadTestConfig({}, ['P-01'])).toThrow('CHERRY_TEST_CHERRYIN_IMAGE_MODEL')
    expect(() => loadTestConfig({}, ['M-01'])).not.toThrow(/EMBEDDING|ANTHROPIC/)
  })

  it('loads provider-scoped values for Playwright', () => {
    const config = loadTestConfig(validEnv)

    expect(config.customProvider).toEqual({
      baseUrl: 'https://gateway.example.test/v1',
      anthropicBaseUrl: 'https://anthropic.example.test',
      apiKey: 'provider-secret',
      chatModel: 'Qwen/Qwen3.6-27B'
    })
    expect(config.customEmbeddingProvider).toEqual({
      apiKey: 'embedding-secret',
      baseUrl: 'https://embedding.example.test/v1',
      model: 'text-embedding-test'
    })
    expect(config.cherryIn.imageModel).toBe('image-test')
    expect(config.customProvider.apiKey).toBe('provider-secret')
    expect(config.customEmbeddingProvider.apiKey).toBe('embedding-secret')
    expect(config.cherryIn.password).toBe('account-secret')
    expect(getSensitiveConfigValues(config)).toEqual([
      'provider-secret',
      'embedding-secret',
      'automation@example.test',
      'account-secret'
    ])
  })

  it('fails before application launch when any required value is blank', () => {
    expect(() =>
      loadTestConfig({
        ...validEnv,
        CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL: '   ',
        CHERRY_TEST_CHERRYIN_ACCOUNT: undefined
      })
    ).toThrow(
      'Missing regression test configuration: CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL, CHERRY_TEST_CHERRYIN_ACCOUNT'
    )
  })

  it.each([
    'CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL',
    'CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL',
    'CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL'
  ])('validates %s before application launch', (name) => {
    expect(() =>
      loadTestConfig({
        ...validEnv,
        [name]: 'not-a-url'
      })
    ).toThrow(`${name} must be an absolute URL`)
  })
})
