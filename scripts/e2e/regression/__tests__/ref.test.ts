import { parseTrustedCommitShas, resolveTrustedRef } from '../ref'

const refs = [
  { name: 'refs/heads/main', sha: 'main-sha' },
  { name: 'refs/heads/release/v2.1.0', sha: 'release-sha' },
  { name: 'refs/heads/feature/untrusted', sha: 'feature-sha' },
  { name: 'refs/tags/v2.0.8', sha: 'tag-object-sha' },
  { name: 'refs/tags/v2.0.8^{}', sha: 'tag-commit-sha' }
]

describe('trusted ref resolution', () => {
  it('resolves trusted branches and peeled release tags to an exact sha', () => {
    expect(resolveTrustedRef('main', refs)).toEqual({
      kind: 'branch',
      name: 'main',
      ref: 'refs/heads/main',
      sha: 'main-sha'
    })
    expect(resolveTrustedRef('release/v2.1.0', refs).sha).toBe('release-sha')
    expect(resolveTrustedRef('v2.0.8', refs)).toEqual({
      kind: 'tag',
      name: 'v2.0.8',
      ref: 'refs/tags/v2.0.8',
      sha: 'tag-commit-sha'
    })
  })

  it('rejects untrusted branches before they can receive test secrets', () => {
    expect(() => resolveTrustedRef('feature/untrusted', refs)).toThrow(
      'Only main, release/* branches, and v* tags are trusted'
    )
  })

  it('rejects missing and ambiguous plain refs', () => {
    expect(() => resolveTrustedRef('v9.9.9', refs)).toThrow('Ref not found: v9.9.9')
    expect(() =>
      resolveTrustedRef('v2.0.8', [...refs, { name: 'refs/heads/v2.0.8', sha: 'ambiguous-branch-sha' }])
    ).toThrow('Ref is ambiguous; use refs/heads/... or refs/tags/...: v2.0.8')
  })

  it('pins an explicitly approved development commit instead of trusting a branch name', () => {
    const sha = 'a'.repeat(40)
    expect(resolveTrustedRef(sha, refs, [sha])).toEqual({ kind: 'branch', name: sha, ref: sha, sha })
    expect(() => resolveTrustedRef(sha, refs, [])).toThrow('not approved')
    expect(() => resolveTrustedRef('b'.repeat(40), refs, [sha])).toThrow('not approved')
    expect(() => resolveTrustedRef('feature/untrusted', refs, [sha])).toThrow('Only main')
  })

  it('rejects trust entries that could approve a moving ref or inject output', () => {
    const sha = 'a'.repeat(40)
    expect(parseTrustedCommitShas(` ${sha},\n${'b'.repeat(40)}`)).toEqual([sha, 'b'.repeat(40)])
    expect(parseTrustedCommitShas('')).toEqual([])
    expect(() => parseTrustedCommitShas('feature/untrusted')).toThrow('full lowercase 40-character SHAs')
    expect(() => parseTrustedCommitShas('abcdef0')).toThrow('full lowercase 40-character SHAs')
    expect(() => parseTrustedCommitShas(sha + '\nsha=untrusted')).toThrow('full lowercase 40-character SHAs')
  })
})
