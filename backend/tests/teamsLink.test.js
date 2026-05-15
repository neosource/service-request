'use strict';

const { buildTeamsChatLink } = require('../src/teamsLink');

describe('buildTeamsChatLink', () => {
  test('produces a teams deep link with required fields', () => {
    const url = buildTeamsChatLink({
      supportContact: 'support@contoso.com',
      caseNumber: 'SR-20260514-00001',
      summary: 'Will not power on',
    });

    expect(url.startsWith('https://teams.microsoft.com/l/chat/0/0?')).toBe(true);

    const parsed = new URL(url);
    expect(parsed.searchParams.get('users')).toBe('support@contoso.com');
    expect(parsed.searchParams.get('topicName')).toBeNull();
    expect(parsed.searchParams.get('message')).toContain('SR-20260514-00001');
    expect(parsed.searchParams.get('message')).toContain('Will not power on');
  });

  test('works without a summary', () => {
    const url = buildTeamsChatLink({
      supportContact: 'support@contoso.com',
      caseNumber: 'SR-20260514-00002',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('message')).toContain('SR-20260514-00002');
    expect(parsed.searchParams.get('message')).not.toContain('Summary:');
  });

  test('throws on missing required fields', () => {
    expect(() => buildTeamsChatLink({ supportContact: 'a@b.c' })).toThrow();
    expect(() => buildTeamsChatLink({ caseNumber: 'SR-1' })).toThrow();
  });

  test('properly url-encodes special characters', () => {
    const url = buildTeamsChatLink({
      supportContact: 'support@contoso.com',
      caseNumber: 'SR-X',
      summary: 'Issue & detail = thing?',
    });
    // URL-encoded ampersand should NOT split the query
    const parsed = new URL(url);
    expect(parsed.searchParams.get('message')).toBe(
      'Need support on case SR-X. Summary: Issue & detail = thing?'
    );
  });
});
