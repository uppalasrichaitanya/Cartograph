import assert from "node:assert/strict";
import test from "node:test";
import {
  GithubSourceError,
  githubDisplayName,
  githubRepoUrl,
  parseGithubSource,
} from "@/lib/github/source";

const accepted: Array<[string, { owner: string; repo: string; ref: string | null }]> = [
  ["owner/repo", { owner: "owner", repo: "repo", ref: null }],
  ["  owner/repo  ", { owner: "owner", repo: "repo", ref: null }],
  ["github.com/owner/repo", { owner: "owner", repo: "repo", ref: null }],
  ["https://github.com/owner/repo", { owner: "owner", repo: "repo", ref: null }],
  ["http://github.com/owner/repo", { owner: "owner", repo: "repo", ref: null }],
  ["https://www.github.com/owner/repo/", { owner: "owner", repo: "repo", ref: null }],
  ["https://github.com/owner/repo.git", { owner: "owner", repo: "repo", ref: null }],
  ["https://github.com/owner/repo?tab=readme#top", { owner: "owner", repo: "repo", ref: null }],
  ["https://github.com/owner/repo/tree/main", { owner: "owner", repo: "repo", ref: "main" }],
  ["https://github.com/owner/repo/tree/feature/x-1.2", { owner: "owner", repo: "repo", ref: "feature/x-1.2" }],
  ["https://github.com/owner/repo/tree/v1.0.0/", { owner: "owner", repo: "repo", ref: "v1.0.0" }],
  ["git@github.com:owner/repo.git", { owner: "owner", repo: "repo", ref: null }],
  ["git@github.com:owner/repo", { owner: "owner", repo: "repo", ref: null }],
  ["sindresorhus/slugify", { owner: "sindresorhus", repo: "slugify", ref: null }],
  ["owner/my.repo_name-2", { owner: "owner", repo: "my.repo_name-2", ref: null }],
];

for (const [input, expected] of accepted) {
  test(`parseGithubSource accepts ${JSON.stringify(input)}`, () => {
    assert.deepEqual(parseGithubSource(input), expected);
  });
}

const rejected: Array<[string, RegExp]> = [
  ["", /paste/i],
  ["   ", /paste/i],
  ["not a link", /owner\/repo/],
  ["https://gitlab.com/owner/repo", /only github\.com/i],
  ["https://evil.example/github.com/owner/repo", /only github\.com/i],
  ["https://github.com.evil.example/owner/repo", /only github\.com/i],
  ["http://169.254.169.254/latest", /only github\.com/i],
  ["https://gist.github.com/owner/abc123", /gist/i],
  ["https://github.com/owner/repo/blob/main/src/a.ts", /file link/i],
  ["https://github.com/owner", /owner\/repo/],
  ["https://github.com/owner/repo/issues/3", /owner\/repo/],
  ["https://github.com/-bad/repo", /owner/i],
  ["https://github.com/bad_owner/repo", /owner/i],
  [`https://github.com/${"a".repeat(40)}/repo`, /owner/i],
  ["owner/..", /repository name/i],
  ["owner/.", /repository name/i],
  ["owner/re%po", /repository name/i],
  [`owner/${"r".repeat(101)}`, /repository name/i],
  ["https://github.com/owner/repo/tree/", /branch or tag/i],
  ["https://github.com/owner/repo/tree/a..b", /branch or tag/i],
  ["https://github.com/owner/repo/tree/a//b", /branch or tag/i],
  ["https://github.com/owner/repo/tree/a b", /branch or tag/i],
  ["https://github.com/owner/repo/tree/%2e%2e", /branch or tag/i],
  ["https://github.com/owner/repo/tree/.", /branch or tag/i],
  ["https://github.com/owner/repo/tree/a/./b", /branch or tag/i],
  [`https://github.com/owner/repo/tree/${"x".repeat(201)}`, /branch or tag/i],
  ["https://user:pw@github.com/owner/repo", /only github\.com/i],
  ["https://github.com:8080/owner/repo", /only github\.com/i],
  ["ftp://github.com/owner/repo", /only github\.com/i],
];

for (const [input, message] of rejected) {
  test(`parseGithubSource rejects ${JSON.stringify(input.slice(0, 60))}`, () => {
    assert.throws(
      () => parseGithubSource(input),
      (error: unknown) => error instanceof GithubSourceError && message.test(error.message),
    );
  });
}

test("githubDisplayName and githubRepoUrl", () => {
  const plain = { owner: "o", repo: "r", ref: null };
  const withRef = { owner: "o", repo: "r", ref: "feat/x" };
  assert.equal(githubDisplayName(plain), "o/r");
  assert.equal(githubDisplayName(withRef), "o/r@feat/x");
  assert.equal(githubRepoUrl(plain), "https://github.com/o/r");
  assert.equal(githubRepoUrl(withRef), "https://github.com/o/r/tree/feat/x");
});
