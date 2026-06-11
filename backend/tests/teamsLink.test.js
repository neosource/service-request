'use strict';

const { buildTeamsChatLink } = require('../src/teamsLink');

describe('buildTeamsChatLink', () => {
  test('produces a teams deep link with required fields', () => {

    const url = buildTeamsChatLink({
      upn: 'agent@contoso.com',
      caseNumber: 'SR-20260514-00001',
    });

    expect(url.startsWith('https://serviceapi-uat.glory-global.com/api/teamsapi/chats?')).toBe(true);

    const parsed = new URL(url);
    expect(parsed.searchParams.get('upn')).toBe('agent@contoso.com');
    expect(parsed.searchParams.get('chatName')).toBe('SR-20260514-00001');
  });

  test('works without a summary', () => {
    const url = buildTeamsChatLink({
      upn: 'agent@contoso.com',
      caseNumber: 'SR-20260514-00002',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('chatName')).toBe('SR-20260514-00002');
  });

  test('throws on missing required fields', () => {
    expect(() => buildTeamsChatLink({ upn: 'a@b.c' })).toThrow();
    expect(() => buildTeamsChatLink({ caseNumber: 'SR-1' })).toThrow();
  });

  test('properly url-encodes special characters', () => {
    const url = buildTeamsChatLink({
      upn: 'agent@contoso.com',
      caseNumber: 'SR-X'
    });
    // URL-encoded ampersand should NOT split the query
    const parsed = new URL(url);
    expect(parsed.searchParams.get('chatName')).toBe('SR-X');
  });
});
