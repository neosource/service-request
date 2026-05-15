'use strict';

/**
 * Builds a Microsoft Teams "deep link" that opens a new chat with the
 * configured support contact, with a starter message pre-filled.
 *
 * Docs: https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/deep-links
 *
 * Format:
 *   https://teams.microsoft.com/l/chat/0/0
 *     ?users=<comma-separated UPNs>
 *     &message=<encoded first message>
 */

function buildTeamsChatLink({ supportContact, caseNumber, summary }) {
  if (!supportContact) throw new Error('supportContact is required');
  if (!caseNumber) throw new Error('caseNumber is required');

  const message =
    `Need support on case ${caseNumber}.` +
    (summary ? ` Summary: ${summary}` : '');

  const params = new URLSearchParams({
    users: supportContact,
    message,
  });

  return `https://teams.microsoft.com/l/chat/0/0?${params.toString()}`;
}

module.exports = { buildTeamsChatLink };
