import { Auth } from "./auth.js";
// Changelog Module - Displays merged PRs from the last week
import { $, $$, clearChildren, el, escapeHtml, hide, show, showToast } from "./utils.js";

export const Changelog = (() => {
  const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;
  const CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 hours
  const CACHE_KEY_PREFIX = "changelog_cache_";

  // Cache management
  const getCacheKey = (org, username) => {
    if (username && org) {
      return `${CACHE_KEY_PREFIX}${org}_${username}`;
    } else if (org) {
      return `${CACHE_KEY_PREFIX}${org}`;
    } else if (username) {
      return `${CACHE_KEY_PREFIX}user_${username}`;
    }
    return `${CACHE_KEY_PREFIX}all`;
  };

  const getCachedData = (key) => {
    try {
      const cached = localStorage.getItem(key);
      if (!cached) return null;

      const { data, timestamp } = JSON.parse(cached);
      const age = Date.now() - timestamp;

      if (age > CACHE_DURATION) {
        localStorage.removeItem(key);
        return null;
      }

      return { data, age };
    } catch (e) {
      console.error("Error reading cache:", e);
      return null;
    }
  };

  const setCachedData = (key, data) => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          data,
          timestamp: Date.now(),
        })
      );
    } catch (e) {
      console.error("Error setting cache:", e);
    }
  };

  const clearCache = () => {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith(CACHE_KEY_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
    showToast("Changelog cache cleared", "success");
  };

  // GitHub search pagination helper
  const githubSearchAll = async (url, maxPages = 10, githubAPI) => {
    const allItems = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const separator = url.includes("?") ? "&" : "?";
      const pageUrl = `${url}${separator}page=${page}`;

      try {
        const response = await githubAPI(pageUrl);
        if (response.items && response.items.length > 0) {
          allItems.push(...response.items);
          hasMore = response.items.length === 100; // GitHub returns max 100 per page
        } else {
          hasMore = false;
        }
        page++;
      } catch (error) {
        console.error(`Error fetching page ${page}:`, error);
        hasMore = false;
      }
    }

    return { items: allItems, total_count: allItems.length };
  };

  // Scoring configuration for PR importance
  const SCORE_CONFIG = {
    textPatterns: [
      { pattern: /\b(security|vulnerability|cve|exploit|ghsa)\b/i, score: 8 },
      { pattern: /\b(revert|rollback|roll back|undo|backout|back out)\b/i, score: 6 },
      { pattern: /\b(feat)\b/, score: 4 },
      { pattern: /\b(breaking|major|refactor|redesign|rework|migrate|replace)\b/, score: 3 },
      { pattern: /\b(add|new|feature|implement|introduce|create)\b/, score: 2 },
      { pattern: /\b(mitigate|warn|error|oom)\b/, score: 2 },
      { pattern: /\b(performance|optimize|speed|fast|perf)\b/, score: 1 },
      { pattern: /\b(fix|update|remove|tune|edit|edits|correct|patch)\b/, score: -1 },
      { pattern: /\b(test)\b/, score: -1 },
      { pattern: /\b(chore|bump|typo|cleanup|lint|format|tweak)\b/, score: -2 },
      { pattern: /\b(dependabot|dependency|dependencies|deps)\b/, score: -3 },
    ],
    labelPatterns: [
      { check: (l) => l.includes("breaking"), score: 3 },
      { check: (l) => l.includes("feature") || l.includes("enhancement"), score: 2 },
      { check: (l) => l.includes("bug") || l.includes("critical"), score: 1 },
      { check: (l) => l.includes("documentation") || l.includes("docs"), score: -1 },
    ],
  };

  // Calculate importance score for PR
  const calculatePRScore = (pr) => {
    let score = 0;

    // Base score from commit count and engagement
    score += pr.commitCount || 0;
    score += pr.comments || 0;
    score += (pr.reactions?.total_count || 0) * 2;

    // Text-based scoring
    const text = ((pr.title || "") + " " + (pr.body || "")).toLowerCase();
    for (const { pattern, score: points } of SCORE_CONFIG.textPatterns) {
      if (text.match(pattern)) score += points;
    }

    // Bot penalty
    if (isBot(pr.user)) score -= 3;

    // Label-based scoring
    const labels = pr.labels?.map((l) => l.name.toLowerCase()) || [];
    for (const { check, score: points } of SCORE_CONFIG.labelPatterns) {
      if (labels.some(check)) score += points;
    }

    // Other factors
    if (pr.requested_reviewers?.length > 2) score += 1;
    if (pr.milestone) score += 2;

    return score;
  };

  // Calculate importance score for direct commits
  const calculateCommitScore = (commit) => {
    // Direct commits get high base score (almost as high as security changes)
    let score = 7;

    // Apply text-based modifiers
    const text = (commit.messageHeadline || "").toLowerCase();
    for (const { pattern, score: points } of SCORE_CONFIG.textPatterns) {
      if (text.match(pattern)) score += points;
    }

    // Bot penalty for commits
    const author = commit.author?.user || { login: commit.author?.email || "unknown" };
    if (isBot(author)) score -= 3;

    return score;
  };

  // Check if a user is a bot
  const isBot = (user) => {
    if (!user) return false;
    const login = user.login.toLowerCase();
    return (
      user.type === "Bot" ||
      login.endsWith("[bot]") ||
      login.endsWith("-bot") ||
      login.endsWith("-robot") ||
      login.includes("dependabot")
    );
  };

  // Check if a PR or commit is a revert
  const isRevert = (item) => {
    const text =
      (item.title || item.messageHeadline || "").toLowerCase() +
      " " +
      (item.body || "").toLowerCase();
    return /\b(revert|rollback|roll back|undo|backout|back out)\b/.test(text);
  };

  // Build GitHub search query for PRs
  const buildPRSearchQuery = (org, username, oneWeekAgoISO) => {
    const base = `type:pr is:merged merged:>=${oneWeekAgoISO}`;
    if (username && org) {
      return `${base} org:${org} author:${username}`;
    } else if (org) {
      return `${base} org:${org}`;
    } else if (username) {
      return `${base} author:${username}`;
    }
    return base;
  };

  // GraphQL with retry logic
  const githubGraphQLWithRetry = async (query, variables = {}, maxRetries = 3) => {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await Auth.githubGraphQL(query, variables);
      } catch (error) {
        lastError = error;
        console.warn(`GraphQL attempt ${attempt} failed:`, error.message);

        // Don't retry on authentication errors
        if (error.message?.includes("authentication") || error.message?.includes("401")) {
          throw error;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 5000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  };

  // Fetch merged PRs with commit counts using GraphQL
  const fetchMergedPRsWithCommits = async (org, username, oneWeekAgoISO) => {
    console.log("Attempting to fetch PRs via GraphQL...");

    const searchQuery = buildPRSearchQuery(org, username, oneWeekAgoISO);

    const query = `
      query SearchPullRequests($query: String!, $first: Int!, $after: String) {
        search(query: $query, type: ISSUE, first: $first, after: $after) {
          issueCount
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ... on PullRequest {
              number
              title
              body
              url
              state
              createdAt
              updatedAt
              mergedAt
              comments {
                totalCount
              }
              commits {
                totalCount
              }
              author {
                login
              }
              repository {
                name
                owner {
                  login
                }
              }
              labels(first: 10) {
                nodes {
                  name
                }
              }
              reactions {
                totalCount
              }
              milestone {
                title
              }
            }
          }
        }
      }
    `;

    try {
      const allPRs = [];
      let hasNextPage = true;
      let cursor = null;

      while (hasNextPage && allPRs.length < 2000) {
        // Limit to 2000 PRs
        const variables = {
          query: searchQuery,
          first: 100,
          after: cursor,
        };

        console.log("Fetching PRs with GraphQL, variables:", variables);
        const data = await githubGraphQLWithRetry(query, variables);

        if (data?.search?.nodes) {
          const prs = data.search.nodes.map((pr) => ({
            number: pr.number,
            title: pr.title,
            body: pr.body,
            html_url: pr.url,
            state: pr.state,
            created_at: pr.createdAt,
            updated_at: pr.updatedAt,
            merged_at: pr.mergedAt,
            comments: pr.comments.totalCount,
            commitCount: pr.commits.totalCount,
            user: pr.author,
            repository_url: `https://api.github.com/repos/${pr.repository.owner.login}/${pr.repository.name}`,
            labels: pr.labels.nodes,
            reactions: pr.reactions,
            milestone: pr.milestone,
          }));

          allPRs.push(...prs);
        }

        hasNextPage = data?.search?.pageInfo?.hasNextPage || false;
        cursor = data?.search?.pageInfo?.endCursor;
      }

      return allPRs;
    } catch (error) {
      console.error("Error fetching PRs via GraphQL:", error);
      // Fall back to REST API
      return null;
    }
  };

  // Fetch commits for a user across all organizations using GraphQL
  const fetchUserCommits = async (username, oneWeekAgoISO) => {
    // First, we need to get the user's ID
    const userQuery = `
      query GetUserId($username: String!) {
        user(login: $username) {
          id
        }
      }
    `;

    try {
      const userData = await githubGraphQLWithRetry(userQuery, { username });
      const userId = userData?.user?.id;

      if (!userId) {
        console.error("Could not find user ID for:", username);
        return [];
      }

      // Now fetch commits using the user ID
      const query = `
        query UserCommits($userId: ID!, $username: String!, $since: GitTimestamp!) {
          user(login: $username) {
            contributionsCollection {
              commitContributionsByRepository(maxRepositories: 100) {
                repository {
                  name
                  owner {
                    login
                  }
                  defaultBranchRef {
                    target {
                      ... on Commit {
                        history(first: 100, since: $since, author: {id: $userId}) {
                          nodes {
                            oid
                            messageHeadline
                            committedDate
                            author {
                              user {
                                login
                              }
                              name
                              email
                            }
                            associatedPullRequests(first: 1) {
                              nodes {
                                number
                                mergedAt
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const variables = {
        userId: userId,
        username: username,
        since: oneWeekAgoISO + "T00:00:00Z",
      };

      console.log("Fetching user commits with variables:", variables);
      const data = await githubGraphQLWithRetry(query, variables);

      const commits = [];
      if (data?.user?.contributionsCollection?.commitContributionsByRepository) {
        for (const contribution of data.user.contributionsCollection
          .commitContributionsByRepository) {
          const repo = contribution.repository;
          if (repo?.defaultBranchRef?.target?.history?.nodes) {
            const repoCommits = repo.defaultBranchRef.target.history.nodes;
            repoCommits.forEach((commit) => {
              // Only include commits from the last week
              const commitDate = new Date(commit.committedDate);
              const oneWeekAgo = new Date(Date.now() - WEEK_IN_MS);
              if (commitDate >= oneWeekAgo) {
                commits.push({
                  ...commit,
                  repository: {
                    name: repo.name,
                    owner: repo.owner.login,
                    fullName: `${repo.owner.login}/${repo.name}`,
                  },
                });
              }
            });
          }
        }
      }
      console.log(`Fetched ${commits.length} commits for user ${username}`);
      return commits;
    } catch (error) {
      console.error("Error fetching user commits via GraphQL:", error);
      // Try simpler approach - search for commits
      try {
        const searchQuery = `
          query SearchCommits($query: String!) {
            search(query: $query, type: ISSUE, first: 100) {
              nodes {
                ... on PullRequest {
                  mergedAt
                  commits(first: 100) {
                    nodes {
                      commit {
                        oid
                        messageHeadline
                        committedDate
                        author {
                          user {
                            login
                          }
                          name
                          email
                        }
                      }
                    }
                  }
                  repository {
                    name
                    owner {
                      login
                    }
                  }
                }
              }
            }
          }
        `;

        const searchStr = `type:pr is:merged merged:>=${oneWeekAgoISO} author:${username}`;
        const searchData = await githubGraphQLWithRetry(searchQuery, { query: searchStr });

        const commits = [];
        if (searchData?.search?.nodes) {
          for (const pr of searchData.search.nodes) {
            if (pr.commits?.nodes) {
              pr.commits.nodes.forEach((node) => {
                const commit = node.commit;
                commits.push({
                  ...commit,
                  repository: {
                    name: pr.repository.name,
                    owner: pr.repository.owner.login,
                    fullName: `${pr.repository.owner.login}/${pr.repository.name}`,
                  },
                });
              });
            }
          }
        }
        console.log(`Fetched ${commits.length} commits via PR search for user ${username}`);
        return commits;
      } catch (fallbackError) {
        console.error("Fallback commit search also failed:", fallbackError);
        return [];
      }
    }
  };

  // Fetch commits for organization using GraphQL
  const fetchOrgCommits = async (org, oneWeekAgoISO) => {
    // Simplified query - fetch fewer repos and commits to avoid timeouts
    const query = `
      query OrganizationCommits($orgLogin: String!, $firstRepos: Int = 20, $since: GitTimestamp!) {
        organization(login: $orgLogin) {
          repositories(first: $firstRepos, orderBy: {field: PUSHED_AT, direction: DESC}) {
            nodes {
              name
              owner {
                login
              }
              pushedAt
              defaultBranchRef {
                target {
                  ... on Commit {
                    history(first: 10, since: $since) {
                      nodes {
                        oid
                        messageHeadline
                        committedDate
                        author {
                          user {
                            login
                          }
                          name
                        }
                        associatedPullRequests(first: 1) {
                          nodes {
                            number
                            mergedAt
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const variables = {
        orgLogin: org,
        firstRepos: 20, // Explicitly set the limit
        since: oneWeekAgoISO + "T00:00:00Z",
      };

      console.log("Fetching org commits with variables:", variables);
      const data = await githubGraphQLWithRetry(query, variables);

      const commits = [];
      if (data?.organization?.repositories?.nodes) {
        for (const repo of data.organization.repositories.nodes) {
          // Skip repos that haven't been pushed to recently
          if (repo.pushedAt && new Date(repo.pushedAt) < new Date(Date.now() - WEEK_IN_MS)) {
            continue;
          }

          if (repo.defaultBranchRef?.target?.history?.nodes) {
            const repoCommits = repo.defaultBranchRef.target.history.nodes;
            repoCommits.forEach((commit) => {
              commits.push({
                ...commit,
                repository: {
                  name: repo.name,
                  owner: repo.owner.login,
                  fullName: `${repo.owner.login}/${repo.name}`,
                },
              });
            });
          }
        }
      }
      console.log(`Fetched ${commits.length} commits from GraphQL`);
      if (commits.length > 0) {
        console.log("Sample commit:", {
          oid: commits[0].oid?.substring(0, 7),
          hasAssociatedPRs: !!commits[0].associatedPullRequests,
          associatedPRs: commits[0].associatedPullRequests,
        });
      }
      return commits;
    } catch (error) {
      console.error("Error fetching commits via GraphQL:", error);
      return [];
    }
  };

  // Team caching
  const TEAM_CACHE_DURATION = 60 * 60 * 1000; // 1 hour
  const TEAM_CACHE_KEY_PREFIX = "changelog_teams_";

  const fetchTeamsWithMembers = async (org, githubAPI) => {
    const cacheKey = `${TEAM_CACHE_KEY_PREFIX}${org}`;
    const cached = getCachedData(cacheKey);

    if (cached) {
      console.log("Using cached team data");
      return cached.data;
    }

    try {
      // Fetch all teams in the org
      const teamsResponse = await githubAPI(`/orgs/${org}/teams?per_page=100`);
      const teams = Array.isArray(teamsResponse) ? teamsResponse : [];

      // Fetch members for each team
      const teamsWithMembers = [];
      for (const team of teams) {
        try {
          const membersResponse = await githubAPI(
            `/orgs/${org}/teams/${team.slug}/members?per_page=100`
          );
          const members = Array.isArray(membersResponse) ? membersResponse : [];
          teamsWithMembers.push({
            name: team.name,
            slug: team.slug,
            members: members.map((m) => m.login),
          });
        } catch (error) {
          console.warn(`Failed to fetch members for team ${team.name}:`, error);
        }
      }

      // Cache with 1-hour expiration
      setCachedData(cacheKey, teamsWithMembers);
      console.log(`Fetched ${teamsWithMembers.length} teams with members`);
      return teamsWithMembers;
    } catch (error) {
      console.error("Failed to fetch teams:", error);
      return null;
    }
  };

  const showChangelogPage = async (state, githubAPI, parseURL) => {
    // Hide other content
    $$('[id$="Content"], #prSections').forEach((el) => el?.setAttribute("hidden", ""));

    // Check for authentication first
    if (!state.accessToken) {
      const loginPrompt = $("loginPrompt");
      show(loginPrompt);
      hide($("changelogContent"));
      return;
    }

    const changelogContent = $("changelogContent");
    const changelogLoading = $("changelogLoading");
    const changelogEmpty = $("changelogEmpty");
    const changelogProjects = $("changelogProjects");
    const changelogTitleText = $("changelogTitleText");
    const changelogPeriod = $("changelogPeriod");
    const changelogBotToggle = $("changelogBotToggle");
    const changelogSummary = $("changelogSummary");
    const includeBots = $("includeBots");
    const clearCacheLink = $("clearChangelogCache");
    const changelogOrgLink = $("changelogOrgLink");
    const changelogOrgLinkAnchor = $("changelogOrgLinkAnchor");
    const userFilterSelect = $("changelogUserFilter");
    const teamFilterSelect = $("changelogTeamFilter");

    if (!changelogContent) return;

    hide($("loginPrompt"));
    show(changelogContent);
    show(changelogLoading);
    hide(changelogEmpty);
    hide(changelogProjects);

    const urlContext = parseURL();
    const { org, username } = urlContext || {};

    // Parse query parameters for filters
    const urlParams = new URLSearchParams(window.location.search);
    const filterUser = urlParams.get("user") || username || "";
    const filterTeam = urlParams.get("team") || "";

    try {
      // Determine what we're fetching
      let titleText = "Changelog";
      let subtitleText = "Recent pull requests merged in the last 7 days";
      let searchQuery = "";

      // Build the search query based on context
      const now = new Date();
      const oneWeekAgo = new Date(Date.now() - WEEK_IN_MS);
      const oneWeekAgoISO = oneWeekAgo.toISOString().split("T")[0];

      // Format the date range
      const formatDate = (date) =>
        date.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
        });
      const periodText = `${formatDate(oneWeekAgo)} – ${formatDate(now)}`;
      changelogPeriod.textContent = periodText;

      // Show bot toggle only for org view
      if (org && !username) {
        show(changelogBotToggle);
      } else {
        hide(changelogBotToggle);
      }

      // Show org link only when viewing a specific user in an org
      if (username && org) {
        show(changelogOrgLink);
        changelogOrgLinkAnchor.href = `https://${org}.reviewGOOSE.dev/changelog`;
      } else {
        hide(changelogOrgLink);
      }

      if (username && org) {
        // Specific user in specific org
        titleText = `${username} in ${org}`;
        subtitleText = `Pull requests merged by ${username}`;
      } else if (org) {
        // All repos in org
        titleText = org;
        subtitleText = `All pull requests merged in this organization`;
      } else if (username) {
        // User's repos across all orgs
        titleText = username;
        subtitleText = `Pull requests merged and commits made across all GitHub organizations`;
      }

      searchQuery = buildPRSearchQuery(org, username, oneWeekAgoISO);

      if (username && org) {
        changelogTitleText.textContent = `${username}'s changes to ${org}`;
      } else if (org) {
        changelogTitleText.textContent = `What's New in ${org}`;
      } else if (username) {
        changelogTitleText.textContent = `What's New from ${username}`;
      } else {
        changelogTitleText.textContent = "What's New";
      }

      // Check cache first
      const cacheKey = getCacheKey(org, username);
      const cached = getCachedData(cacheKey);

      // Setup clear cache handler
      if (clearCacheLink) {
        clearCacheLink.onclick = async (e) => {
          e.preventDefault();
          // Clear the cache for this specific view
          const cacheKey = getCacheKey(org, username);
          localStorage.removeItem(cacheKey);

          // Show loading state
          show(changelogLoading);
          hide(changelogProjects);
          hide(changelogEmpty);

          // Re-run the page to fetch fresh data (including GraphQL)
          await showChangelogPage(state, githubAPI, parseURL);
        };
      }

      let mergedPRs;
      let commits = [];
      let commitsFetchFailed = false;

      // Fetch teams if we have an org
      let teamsData = null;
      const hasToken = !!Auth.getStoredToken();
      console.log("Auth token available:", hasToken);
      if (org && hasToken) {
        teamsData = await fetchTeamsWithMembers(org, githubAPI);

        // Populate team dropdown
        if (teamFilterSelect && teamsData) {
          show(teamFilterSelect);
          clearChildren(teamFilterSelect);
          const allTeamsOption = el("option", { attrs: { value: "" }, text: "All teams" });
          teamFilterSelect.appendChild(allTeamsOption);

          teamsData.forEach((team) => {
            const option = el("option", {
              attrs: { value: team.slug },
              text: team.name,
            });
            if (team.slug === filterTeam) option.selected = true;
            teamFilterSelect.appendChild(option);
          });

          teamFilterSelect.disabled = false;
        } else if (teamFilterSelect) {
          // Teams API unavailable - hide the dropdown completely
          hide(teamFilterSelect);
        }
      } else if (teamFilterSelect) {
        // No org context - hide the dropdown
        hide(teamFilterSelect);
      }

      // Helper to update URL with filters
      const updateURLWithFilters = (user, team) => {
        const params = new URLSearchParams();
        if (user) params.set("user", user);
        if (team) params.set("team", team);
        const newURL = `/changelog${params.toString() ? "?" + params.toString() : ""}`;
        window.history.pushState({}, "", newURL);
      };

      // Define all the functions before using them
      const filterAndRenderPRs = () => {
        const shouldIncludeBots = !includeBots || includeBots.checked;
        const currentUserFilter = userFilterSelect?.value || "";
        const currentTeamFilter = teamFilterSelect?.value || "";

        // Get team members if filtering by team
        let teamMembers = [];
        if (currentTeamFilter && teamsData) {
          const team = teamsData.find((t) => t.slug === currentTeamFilter);
          if (team) teamMembers = team.members;
        }

        // Filter PRs based on preferences
        let filteredPRs = mergedPRs;

        // Filter by bot preference
        if (!shouldIncludeBots) {
          filteredPRs = filteredPRs.filter((pr) => !isBot(pr.user));
        }

        // Filter by user
        if (currentUserFilter) {
          filteredPRs = filteredPRs.filter((pr) => pr.user.login === currentUserFilter);
        }

        // Filter by team
        if (currentTeamFilter && teamMembers.length > 0) {
          filteredPRs = filteredPRs.filter((pr) => teamMembers.includes(pr.user.login));
        }

        // Populate user dropdown with contributors from the filtered PRs (or all if no team filter)
        if (userFilterSelect) {
          // Get unique users from all PRs
          const users = new Set();
          mergedPRs.forEach((pr) => {
            if (!isBot(pr.user)) {
              users.add(pr.user.login);
            }
          });

          clearChildren(userFilterSelect);
          const allUsersOption = el("option", { attrs: { value: "" }, text: "All users" });
          userFilterSelect.appendChild(allUsersOption);

          Array.from(users)
            .sort()
            .forEach((username) => {
              const option = el("option", {
                attrs: { value: username },
                text: username,
              });
              if (username === currentUserFilter) option.selected = true;
              userFilterSelect.appendChild(option);
            });
        }

        // Group PRs by project
        const projectsData = {};

        for (const pr of filteredPRs) {
          const repoUrl = pr.repository_url || pr.html_url.split("/pull/")[0];
          const repoFullName = repoUrl
            .replace("https://api.github.com/repos/", "")
            .replace("https://github.com/", "");

          if (!projectsData[repoFullName]) {
            projectsData[repoFullName] = {
              name: repoFullName,
              prs: [],
              commits: [],
              contributors: new Set(),
            };
          }

          projectsData[repoFullName].prs.push(pr);
          projectsData[repoFullName].contributors.add(pr.user.login);
        }

        console.log("Projects with PRs:", Object.keys(projectsData));

        // Create a map of PR numbers by repository for faster lookup
        const prsByRepo = {};
        for (const [repoName, project] of Object.entries(projectsData)) {
          prsByRepo[repoName] = new Set(project.prs.map((pr) => pr.number));
        }

        // Add commits to projects (for repos without PRs)
        if (commits && commits.length > 0) {
          console.log("Processing commits:", commits.length);
          for (const commit of commits) {
            const repoFullName = commit.repository.fullName;

            // Skip if commit is already associated with a PR we have
            if (commit.associatedPullRequests?.nodes?.length > 0) {
              const associatedPR = commit.associatedPullRequests.nodes[0];
              console.log(
                `Commit ${commit.oid.substring(0, 7)} in ${repoFullName} has associated PR #${associatedPR.number}`
              );
              // Check if the PR was merged within our time window
              if (associatedPR.mergedAt) {
                const mergedDate = new Date(associatedPR.mergedAt);
                const oneWeekAgo = new Date(Date.now() - WEEK_IN_MS);
                if (mergedDate >= oneWeekAgo) {
                  // Check if we already have this PR in our list
                  const hasPR = prsByRepo[repoFullName]?.has(associatedPR.number);
                  console.log(
                    `PR #${associatedPR.number} ${hasPR ? "found" : "NOT found"} in ${repoFullName} PRs (has ${prsByRepo[repoFullName]?.size || 0} PRs)`
                  );
                  if (hasPR) continue;
                }
              }
            }

            // Get commit author
            const author = commit.author?.user || { login: commit.author?.email || "unknown" };

            // Skip bot commits based on preference
            if (!shouldIncludeBots && isBot(author)) continue;

            // Skip commits that don't match user filter
            if (currentUserFilter && author.login !== currentUserFilter) continue;

            // Skip commits that don't match team filter
            if (currentTeamFilter && teamMembers.length > 0 && !teamMembers.includes(author.login))
              continue;

            if (!projectsData[repoFullName]) {
              projectsData[repoFullName] = {
                name: repoFullName,
                prs: [],
                commits: [],
                contributors: new Set(),
              };
            }

            projectsData[repoFullName].commits.push(commit);
            projectsData[repoFullName].contributors.add(author.login);
          }
        }

        renderProjects(projectsData, commitsFetchFailed);
      };

      const renderProjects = (projectsData, commitsFetchFailed = false) => {
        hide(changelogLoading);

        // Filter out empty projects and calculate total importance score
        const projectsWithContent = Object.values(projectsData).filter(
          (project) => project.prs.length > 0 || project.commits.length > 0
        );

        projectsWithContent.forEach((project) => {
          // Calculate score based on PRs and commits
          const prScore = project.prs.reduce((sum, pr) => sum + calculatePRScore(pr), 0);
          const commitScore = project.commits.length * 2; // Give some weight to commits
          project.totalScore = prScore + commitScore;
        });

        // Sort projects by cumulative importance score
        const projectsArray = projectsWithContent.sort((a, b) => b.totalScore - a.totalScore);
        const totalPRs = projectsArray.reduce((sum, p) => sum + p.prs.length, 0);
        const totalCommits = projectsArray.reduce((sum, p) => sum + p.commits.length, 0);
        const totalChanges = totalPRs + totalCommits;
        const totalContributors = new Set(projectsArray.flatMap((p) => Array.from(p.contributors)))
          .size;
        const activeProjects = projectsArray.length;

        // Count reverts
        const totalReverts = projectsArray.reduce((sum, p) => {
          const prReverts = p.prs.filter((pr) => isRevert(pr)).length;
          const commitReverts = p.commits.filter((commit) => isRevert(commit)).length;
          return sum + prReverts + commitReverts;
        }, 0);

        // Check if we have any content to display (PRs or commits)
        const hasContent =
          projectsArray.length > 0 &&
          projectsArray.some((p) => p.prs.length > 0 || p.commits.length > 0);

        if (!hasContent) {
          show(changelogEmpty);
          hide(changelogProjects);
          hide(changelogSummary);

          // Update empty message based on context
          const emptyMessage = changelogEmpty.querySelector("p");
          if (emptyMessage) {
            if (org && !username) {
              emptyMessage.textContent = "No pull requests or commits found in the last 7 days";
            } else if (!org && username) {
              emptyMessage.textContent = `No pull requests merged or commits made by ${username} in the last 7 days`;
            } else {
              emptyMessage.textContent = "No pull requests merged in the last 7 days";
            }
          }
        } else {
          hide(changelogEmpty);
          show(changelogProjects);

          // Show summary for org view or user view
          if ((org && !username) || (!org && username)) {
            show(changelogSummary);
            const summaryHTML = `
              <div class="summary-grid centered">
                <div class="summary-item">
                  <div class="summary-value">${totalPRs}</div>
                  <div class="summary-label">Pull Requests</div>
                </div>
                ${
                  (org && !username) || (!org && username)
                    ? `
                <div class="summary-item">
                  <div class="summary-value">${commitsFetchFailed ? "N/A" : totalCommits}</div>
                  <div class="summary-label">Direct Commits</div>
                  ${commitsFetchFailed ? '<div class="summary-detail">Unable to fetch</div>' : ""}
                </div>
                `
                    : ""
                }
                <div class="summary-item">
                  <div class="summary-value">${activeProjects}</div>
                  <div class="summary-label">Active Projects</div>
                </div>
                <div class="summary-item${totalReverts > 0 ? " revert-item" : ""}">
                  <div class="summary-value">${totalReverts}</div>
                  <div class="summary-label">Reverts</div>
                </div>
                ${
                  org && !username
                    ? `
                <div class="summary-item">
                  <div class="summary-value">${totalContributors}</div>
                  <div class="summary-label">Contributors</div>
                </div>
                `
                    : ""
                }
              </div>
            `;
            if (changelogSummary) changelogSummary.innerHTML = summaryHTML;
          } else {
            hide(changelogSummary);
          }

          // Render all projects
          changelogProjects.innerHTML = `
            <div class="projects-grid">
              ${projectsArray
                .map((project) => {
                  // Sort PRs by score (highest first)
                  const sortedPRs = [...project.prs].sort((a, b) => {
                    const scoreA = calculatePRScore(a);
                    const scoreB = calculatePRScore(b);
                    // Sort by score first, then by PR number as tiebreaker
                    return scoreB - scoreA || b.number - a.number;
                  });

                  // Sort commits by score (highest first), then by date
                  const sortedCommits = [...project.commits].sort((a, b) => {
                    const scoreA = calculateCommitScore(a);
                    const scoreB = calculateCommitScore(b);
                    if (scoreA !== scoreB) return scoreB - scoreA;
                    return new Date(b.committedDate) - new Date(a.committedDate);
                  });

                  return `
                  <section class="changelog-section">
                    <h3 class="section-title"><a href="https://github.com/${project.name}" target="_blank" rel="noopener">${project.name}</a></h3>
                    <ul class="change-list">
                      ${[...sortedPRs, ...sortedCommits]
                        .map((item) => {
                          if (item.number) {
                            // It's a PR
                            const score = calculatePRScore(item);
                            const labels = item.labels?.map((l) => l.name.toLowerCase()) || [];
                            const importanceClass =
                              score >= 12 ? "high" : score >= 8 ? "medium" : "normal";
                            const titleLower = item.title.toLowerCase();
                            const isSecurityPR =
                              labels.some((l) => l.includes("security")) ||
                              titleLower.includes("security") ||
                              titleLower.includes("cve") ||
                              titleLower.includes("vulnerability") ||
                              titleLower.includes("ghsa") ||
                              /\bghsa-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}\b/i.test(item.title) ||
                              /\bcve-\d{4}-\d{4,}/i.test(item.title);

                            const isRevertPR = isRevert(item);

                            return `
                            <li class="change-item importance-${importanceClass}${isSecurityPR ? " security-pr" : ""}${isRevertPR ? " revert-pr" : ""}">
                              <div class="change-header">
                                <a href="${item.html_url}" target="_blank" class="change-link">
                                  <span class="change-title">${escapeHtml(item.title)}</span>
                                  <span class="change-pr-number">#${item.number}</span>
                                </a>
                              </div>
                              ${item.comments > 5 ? '<div class="change-meta"><span class="discussion-indicator">💬 Active discussion</span></div>' : ""}
                            </li>
                          `;
                          } else {
                            // It's a direct commit
                            const score = calculateCommitScore(item);
                            const importanceClass =
                              score >= 8 ? "high" : score >= 5 ? "medium" : "normal";
                            const msgLower = item.messageHeadline.toLowerCase();
                            const isSecurityCommit =
                              msgLower.includes("security") ||
                              msgLower.includes("cve") ||
                              msgLower.includes("vulnerability") ||
                              msgLower.includes("ghsa") ||
                              /\bghsa-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}\b/i.test(
                                item.messageHeadline
                              ) ||
                              /\bcve-\d{4}-\d{4,}/i.test(item.messageHeadline);

                            const isRevertCommit = isRevert(item);

                            return `
                            <li class="change-item importance-${importanceClass} direct-commit${isSecurityCommit ? " security-pr" : ""}${isRevertCommit ? " revert-pr" : ""}">
                              <div class="change-header">
                                <a href="https://github.com/${item.repository.fullName}/commit/${item.oid}" target="_blank" class="change-link">
                                  <span class="change-title">${escapeHtml(item.messageHeadline)}</span>
                                  <span class="change-commit-hash">${item.oid.substring(0, 7)}</span>
                                </a>
                              </div>
                            </li>
                          `;
                          }
                        })
                        .join("")}
                    </ul>
                  </section>
                `;
                })
                .join("")}
            </div>
          `;
        }
      };

      if (cached) {
        console.log("Using cached changelog data");
        if (cached.data.prs) {
          // New cache format
          mergedPRs = cached.data.prs;
          commits = cached.data.commits || [];
          commitsFetchFailed = cached.data.commitsFetchFailed || false;
          console.log("Cached changelog data (new format):", {
            prsCount: mergedPRs.length,
            commitsCount: commits.length,
            commitsFetchFailed: commitsFetchFailed,
            cacheAge: Math.round(cached.age / 60000) + " minutes",
            samplePRs: mergedPRs.slice(0, 3).map((pr) => ({
              number: pr.number,
              title: pr.title,
              repo: pr.repository_url?.replace("https://api.github.com/repos/", "") || "unknown",
            })),
            sampleCommits: commits.slice(0, 3).map((c) => ({
              sha: c.oid?.substring(0, 7) || "unknown",
              message: c.messageHeadline || "no message",
              repo: c.repository?.fullName || "unknown",
            })),
          });
        } else {
          // Old cache format
          mergedPRs = cached.data;
          console.log("Cached changelog data (old format):", {
            prsCount: mergedPRs.length,
            cacheAge: Math.round(cached.age / 60000) + " minutes",
            samplePRs: mergedPRs.slice(0, 3).map((pr) => ({
              number: pr.number,
              title: pr.title,
              repo: pr.repository_url?.replace("https://api.github.com/repos/", "") || "unknown",
            })),
          });
        }
        const ageMinutes = Math.floor(cached.age / 60000);
        if (clearCacheLink) {
          const ageText =
            ageMinutes < 60 ? `${ageMinutes}m ago` : `${Math.floor(ageMinutes / 60)}h ago`;
          clearCacheLink.title = `Cached ${ageText}. Click to refresh.`;
        }

        // Render with cached data
        filterAndRenderPRs();

        // Setup filter event listeners
        if (userFilterSelect) {
          userFilterSelect.addEventListener("change", () => {
            updateURLWithFilters(userFilterSelect.value, teamFilterSelect?.value || "");
            filterAndRenderPRs();
          });
        }

        if (teamFilterSelect) {
          teamFilterSelect.addEventListener("change", () => {
            updateURLWithFilters(userFilterSelect?.value || "", teamFilterSelect.value);
            filterAndRenderPRs();
          });
        }

        if (includeBots) {
          includeBots.addEventListener("change", filterAndRenderPRs);
        }
      } else {
        console.log("Fetching fresh changelog data");

        // Try to fetch PRs with commit counts using GraphQL
        let usedGraphQL = false;
        try {
          mergedPRs = await fetchMergedPRsWithCommits(org, username, oneWeekAgoISO);
          if (mergedPRs && mergedPRs.length > 0) {
            console.log(
              `Successfully fetched ${mergedPRs.length} PRs via GraphQL with commit counts`
            );
            usedGraphQL = true;
          } else {
            console.log("GraphQL returned no results, falling back to REST API");
            mergedPRs = null;
          }
        } catch (error) {
          console.warn("GraphQL failed, falling back to REST API:", error);
          mergedPRs = null;
        }

        // If GraphQL fails or returns nothing, fall back to REST API
        if (!mergedPRs || mergedPRs.length === 0) {
          const searchUrl = `/search/issues?q=${encodeURIComponent(searchQuery)}&sort=updated&order=desc&per_page=100`;
          const searchResults = await githubSearchAll(searchUrl, 20, githubAPI);
          mergedPRs = searchResults.items || [];
          console.log(`Fetched ${mergedPRs.length} PRs via REST API`);
        }

        // Fetch commits - for org view or user view across all orgs
        commits = [];
        commitsFetchFailed = false;
        try {
          if (org && !username) {
            // Fetch all commits in an organization
            commits = await fetchOrgCommits(org, oneWeekAgoISO);
            console.log("Successfully fetched org commits via GraphQL");
          } else if (!org && username) {
            // Fetch user's commits across all organizations
            commits = await fetchUserCommits(username, oneWeekAgoISO);
            console.log("Successfully fetched user commits via GraphQL");
          }
        } catch (error) {
          console.warn("Failed to fetch commits via GraphQL, continuing without commits:", error);
          commits = [];
          commitsFetchFailed = true;
        }

        // Cache the results (including the fetch status)
        setCachedData(cacheKey, { prs: mergedPRs, commits, commitsFetchFailed });
        if (clearCacheLink) {
          clearCacheLink.title = "Data is fresh. Click to force refresh.";
        }

        // Now that we have all data (PRs and commits), render the page
        filterAndRenderPRs();

        // Setup filter event listeners
        if (userFilterSelect) {
          userFilterSelect.addEventListener("change", () => {
            updateURLWithFilters(userFilterSelect.value, teamFilterSelect?.value || "");
            filterAndRenderPRs();
          });
        }

        if (teamFilterSelect) {
          teamFilterSelect.addEventListener("change", () => {
            updateURLWithFilters(userFilterSelect?.value || "", teamFilterSelect.value);
            filterAndRenderPRs();
          });
        }

        if (includeBots) {
          includeBots.addEventListener("change", filterAndRenderPRs);
        }
      }
    } catch (error) {
      console.error("Error loading changelog:", error);
      hide(changelogLoading);
      showToast("Failed to load changelog. Please try again.", "error");
    }
  };

  return {
    showChangelogPage,
    clearCache,
  };
})();
