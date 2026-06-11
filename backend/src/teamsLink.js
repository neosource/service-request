'use strict';

/**
 * Builds a Microsoft Teams chat API link for the provided UPN and case number.
 *
 * Docs: https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/deep-links
 *
 * Format:
 *   https://teams.microsoft.com/l/chat/0/0
 *     ?users=<comma-separated UPNs>
 *     &message=<encoded first message>
 */

function buildTeamsChatLink({ upn, caseNumber }) {
  // the URL for the Teams chat API that we created
  const teamsChatLink = 'https://serviceapi-uat.glory-global.com/api/teamsapi/chats';

  if (!upn) throw new Error('upn is required');
  if (!caseNumber) throw new Error('caseNumber is required');

  const params = new URLSearchParams({
    upn,
    chatName: caseNumber,
    'subscription-key': '3bc3b9e04e7c45bbb90630a458600ed5'
  });

  const url = `${teamsChatLink}?${params.toString()}`;
  const maskedParams = {
    upn,
    chatName: caseNumber,
    'subscription-key': '***masked***',
  };
  
  
  return url;
}

module.exports = { buildTeamsChatLink };
