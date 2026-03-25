const GITHUB_BASE_URL = 'https://github.com/Guepard-Corp/qwery-core';

export const GITHUB_URLS = {
  repo: GITHUB_BASE_URL,
  issues: `${GITHUB_BASE_URL}/issues`,
  newIssue: `${GITHUB_BASE_URL}/issues/new`,
  discussions: `${GITHUB_BASE_URL}/discussions`,
  pulls: `${GITHUB_BASE_URL}/pulls`,
  securityAdvisories: `${GITHUB_BASE_URL}/security/advisories`,
  actionsBuildAndTest: `${GITHUB_BASE_URL}/actions/workflows/build_and_test.yml`,
  compareUnreleased: `${GITHUB_BASE_URL}/compare/v0.1.0...HEAD`,
} as const;
