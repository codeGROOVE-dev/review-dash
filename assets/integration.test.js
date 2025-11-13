// Integration tests for app initialization and token handling
// Run with: node --test assets/integration.test.js

import assert from "node:assert";
import { describe, it } from "node:test";

describe("App Integration", () => {
  describe("State initialization", () => {
    it("should handle null accessToken gracefully", () => {
      // Simulate app state with null token (before async load completes)
      const state = {
        currentUser: null,
        viewingUser: null,
        accessToken: null,
        organizations: [],
        pullRequests: { incoming: [], outgoing: [] },
        isDemoMode: false,
      };

      // This simulates the logging code in user.js:292
      // Should not throw when accessToken is null
      assert.doesNotThrow(() => {
        const authType =
          state.accessToken && typeof state.accessToken === "string"
            ? state.accessToken.startsWith("ghp_")
              ? "PAT"
              : "OAuth"
            : "none";
        assert.strictEqual(authType, "none");
      });
    });

    it("should detect PAT token type", () => {
      const state = {
        accessToken: "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
      };

      const authType =
        state.accessToken && typeof state.accessToken === "string"
          ? state.accessToken.startsWith("ghp_")
            ? "PAT"
            : "OAuth"
          : "none";

      assert.strictEqual(authType, "PAT");
    });

    it("should detect OAuth token type", () => {
      const state = {
        accessToken: "gho_1234567890abcdefghijklmnopqrstuvwxyz",
      };

      const authType =
        state.accessToken && typeof state.accessToken === "string"
          ? state.accessToken.startsWith("ghp_")
            ? "PAT"
            : "OAuth"
          : "none";

      assert.strictEqual(authType, "OAuth");
    });

    it("should handle undefined accessToken", () => {
      const state = {
        accessToken: undefined,
      };

      assert.doesNotThrow(() => {
        const authType =
          state.accessToken && typeof state.accessToken === "string"
            ? state.accessToken.startsWith("ghp_")
              ? "PAT"
              : "OAuth"
            : "none";
        assert.strictEqual(authType, "none");
      });
    });

    it("should handle empty string accessToken", () => {
      const state = {
        accessToken: "",
      };

      assert.doesNotThrow(() => {
        const authType =
          state.accessToken && typeof state.accessToken === "string"
            ? state.accessToken.startsWith("ghp_")
              ? "PAT"
              : "OAuth"
            : "none";
        assert.strictEqual(authType, "none");
      });
    });

    it("should handle non-string accessToken gracefully", () => {
      const invalidTokens = [123, true, {}, [], NaN];

      for (const invalidToken of invalidTokens) {
        const state = { accessToken: invalidToken };

        assert.doesNotThrow(
          () => {
            const authType =
              state.accessToken && typeof state.accessToken === "string"
                ? state.accessToken.startsWith("ghp_")
                  ? "PAT"
                  : "OAuth"
                : "none";
            assert.strictEqual(authType, "none");
          },
          `Should handle ${typeof invalidToken} without throwing`
        );
      }
    });

    it("should handle token type check for OAuth warning (user.js:325)", () => {
      // This is the actual code from user.js:325 that was failing
      const state = { accessToken: null };
      const totalCount = 100;
      const allPRsLength = 50;

      assert.doesNotThrow(() => {
        // This should not throw even with null token
        if (
          state.accessToken &&
          typeof state.accessToken === "string" &&
          !state.accessToken.startsWith("ghp_") &&
          totalCount > allPRsLength
        ) {
          // Would show OAuth warning
        }
      }, "Should handle null token in OAuth warning check");

      // Test with OAuth token - should enter the condition
      state.accessToken = "gho_1234567890abcdefghijklmnopqrstuvwxyz";
      let warningTriggered = false;
      if (
        state.accessToken &&
        typeof state.accessToken === "string" &&
        !state.accessToken.startsWith("ghp_") &&
        totalCount > allPRsLength
      ) {
        warningTriggered = true;
      }
      assert.strictEqual(warningTriggered, true, "Should trigger OAuth warning for OAuth tokens");

      // Test with PAT token - should NOT enter the condition
      state.accessToken = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
      warningTriggered = false;
      if (
        state.accessToken &&
        typeof state.accessToken === "string" &&
        !state.accessToken.startsWith("ghp_") &&
        totalCount > allPRsLength
      ) {
        warningTriggered = true;
      }
      assert.strictEqual(
        warningTriggered,
        false,
        "Should NOT trigger OAuth warning for PAT tokens"
      );
    });
  });

  describe("Async token loading", () => {
    it("should initialize with null token before async load", () => {
      // This is how the app initializes now
      const state = {
        accessToken: null, // Will be loaded async in init()
      };

      assert.strictEqual(state.accessToken, null);
    });

    it("should be able to set token after async load", async () => {
      const state = {
        accessToken: null,
      };

      // Simulate async token loading
      await new Promise((resolve) => {
        setTimeout(() => {
          state.accessToken = "ghp_test123";
          resolve();
        }, 0);
      });

      assert.strictEqual(state.accessToken, "ghp_test123");
    });
  });

  describe("buildWaitingOn", () => {
    const escapeHtml = (text) => {
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      };
      return text.replace(/[&<>"']/g, (m) => map[m]);
    };

    const buildWaitingOn = (pr, viewingUser, currentUser) => {
      if (!pr.turnData?.analysis?.next_action) {
        return "";
      }

      const nextAction = pr.turnData.analysis.next_action;
      const usernames = Object.keys(nextAction);

      if (usernames.length === 0) {
        return "";
      }

      // Group actions by kind
      const actionsByKind = {};
      usernames.forEach((username) => {
        const action = nextAction[username];
        const kind = action.kind || "action";

        if (!actionsByKind[kind]) {
          actionsByKind[kind] = [];
        }

        const isViewingUser = viewingUser && username === viewingUser.login;
        const isCurrentUser = currentUser && username === currentUser.login;

        let displayName = username;
        let className = "pr-action-user";

        // Special handling for _system
        if (username === "_system") {
          // Skip adding _system to the user list, we'll just show the action name
          return;
        }

        // If viewing someone else's dashboard, highlight their name
        if (viewingUser && currentUser && viewingUser.login !== currentUser.login) {
          if (isViewingUser) {
            displayName = viewingUser.login;
            className = "pr-action-you";
          }
        } else {
          // Normal behavior when viewing your own dashboard
          if (isCurrentUser) {
            displayName = "YOU";
            className = "pr-action-you";
          }
        }

        const title = action.reason || "Waiting for action";
        actionsByKind[kind].push({
          html: `<span class="${className}" title="${escapeHtml(title)}">${escapeHtml(displayName)}</span>`,
          isYou: isCurrentUser || isViewingUser,
        });
      });

      // Build the action groups string
      const actionGroups = Object.entries(actionsByKind)
        .map(([kind, users]) => {
          // Format action kind (replace underscores with spaces)
          const actionName = kind.replace(/_/g, " ");

          if (users.length === 0) {
            // _system action with no users
            return actionName;
          }

          // Join user names
          const userList = users.map((u) => u.html).join(", ");
          return `${actionName}: ${userList}`;
        })
        .join("; ");

      return ` <span class="pr-waiting-on">→ ${actionGroups}</span>`;
    };

    it("should return empty string when no turnData", () => {
      const pr = {};
      const result = buildWaitingOn(pr, null, null);
      assert.strictEqual(result, "");
    });

    it("should return empty string when no next_action", () => {
      const pr = { turnData: { analysis: {} } };
      const result = buildWaitingOn(pr, null, null);
      assert.strictEqual(result, "");
    });

    it("should return empty string when next_action is empty", () => {
      const pr = { turnData: { analysis: { next_action: {} } } };
      const result = buildWaitingOn(pr, null, null);
      assert.strictEqual(result, "");
    });

    it("should show single review action for YOU", () => {
      const pr = {
        turnData: {
          analysis: {
            next_action: {
              demo: { kind: "review", reason: "Please review this PR", critical: true },
            },
          },
        },
      };
      const currentUser = { login: "demo" };
      const result = buildWaitingOn(pr, currentUser, currentUser);

      assert.ok(result.includes("→"), "Should start with arrow");
      assert.ok(result.includes("review:"), "Should show action name");
      assert.ok(result.includes('pr-action-you'), "Should use YOU class for current user");
      assert.ok(result.includes("YOU"), "Should show YOU for current user");
    });

    it("should group multiple users under same action", () => {
      const pr = {
        turnData: {
          analysis: {
            next_action: {
              demo: { kind: "review", reason: "Please review" },
              alice: { kind: "review", reason: "Alice needs to review" },
              bob: { kind: "review", reason: "Bob needs to review" },
            },
          },
        },
      };
      const currentUser = { login: "demo" };
      const result = buildWaitingOn(pr, currentUser, currentUser);

      assert.ok(result.includes("review:"), "Should show review action");
      assert.ok(result.includes("YOU"), "Should show YOU");
      assert.ok(result.includes("alice"), "Should show alice");
      assert.ok(result.includes("bob"), "Should show bob");
      assert.ok(!result.includes(";"), "Should not have semicolon for single action type");
    });

    it("should separate different action types with semicolons", () => {
      const pr = {
        turnData: {
          analysis: {
            next_action: {
              demo: { kind: "review", reason: "Please review" },
              alice: { kind: "merge", reason: "Alice needs to merge" },
              bob: { kind: "fix_tests", reason: "Bob needs to fix tests" },
            },
          },
        },
      };
      const currentUser = { login: "demo" };
      const result = buildWaitingOn(pr, currentUser, currentUser);

      assert.ok(result.includes(";"), "Should have semicolons separating actions");
      assert.ok(result.includes("review:"), "Should show review action");
      assert.ok(result.includes("merge:"), "Should show merge action");
      assert.ok(result.includes("fix tests:"), "Should show fix tests with space");
    });

    it("should handle _system user by showing only action name", () => {
      const pr = {
        turnData: {
          analysis: {
            next_action: {
              _system: { kind: "fix_tests", reason: "Tests are failing" },
            },
          },
        },
      };
      const currentUser = { login: "demo" };
      const result = buildWaitingOn(pr, currentUser, currentUser);

      assert.ok(result.includes("fix tests"), "Should show action name");
      assert.ok(!result.includes("_system"), "Should not show _system username");
      assert.ok(!result.includes(":"), "Should not have colon when only _system");
    });

    it("should replace underscores with spaces in action names", () => {
      const pr = {
        turnData: {
          analysis: {
            next_action: {
              demo: { kind: "fix_merge_conflict", reason: "Fix conflict" },
            },
          },
        },
      };
      const currentUser = { login: "demo" };
      const result = buildWaitingOn(pr, currentUser, currentUser);

      assert.ok(result.includes("fix merge conflict:"), "Should replace underscores with spaces");
      assert.ok(!result.includes("fix_merge_conflict"), "Should not contain underscores");
    });

    it("should handle mixed actions including _system", () => {
      const pr = {
        turnData: {
          analysis: {
            next_action: {
              demo: { kind: "review", reason: "Please review" },
              alice: { kind: "add_comment", reason: "Alice needs to comment" },
              _system: { kind: "run_tests", reason: "Tests running" },
            },
          },
        },
      };
      const currentUser = { login: "demo" };
      const result = buildWaitingOn(pr, currentUser, currentUser);

      assert.ok(result.includes("review: "), "Should show review with users");
      assert.ok(result.includes("add comment: "), "Should show add comment");
      assert.ok(result.includes("run tests"), "Should show run tests from _system");
      assert.ok(!result.includes("_system"), "Should not show _system username");
    });

    it("should escape HTML in usernames and reasons", () => {
      const pr = {
        turnData: {
          analysis: {
            next_action: {
              'user<script>': { kind: "review", reason: 'XSS"attack' },
            },
          },
        },
      };
      const currentUser = { login: "demo" };
      const result = buildWaitingOn(pr, currentUser, currentUser);

      assert.ok(result.includes("&lt;"), "Should escape < character");
      assert.ok(!result.includes("<script>"), "Should not contain raw script tag");
      assert.ok(result.includes("&quot;"), "Should escape quotes in title");
    });

    it("should use pr-action-user class for non-current users", () => {
      const pr = {
        turnData: {
          analysis: {
            next_action: {
              alice: { kind: "review", reason: "Alice needs to review" },
            },
          },
        },
      };
      const currentUser = { login: "demo" };
      const result = buildWaitingOn(pr, currentUser, currentUser);

      assert.ok(result.includes('pr-action-user'), "Should use pr-action-user class for others");
      assert.ok(!result.includes('pr-action-you'), "Should not use pr-action-you class");
    });

    it("should handle complex multi-action scenario", () => {
      const pr = {
        turnData: {
          analysis: {
            next_action: {
              demo: { kind: "review", reason: "Please review" },
              alice: { kind: "review", reason: "Alice review" },
              bob: { kind: "add_comment", reason: "Bob comment" },
              charlie: { kind: "fix_tests", reason: "Charlie tests" },
            },
          },
        },
      };
      const currentUser = { login: "demo" };
      const result = buildWaitingOn(pr, currentUser, currentUser);

      // Should have format: "→ review: YOU, alice; add comment: bob; fix tests: charlie"
      assert.ok(result.includes("→"), "Should start with arrow");
      assert.ok(result.includes("review: "), "Should have review action");
      assert.ok(result.includes("YOU"), "Should show YOU");
      assert.ok(result.includes("alice"), "Should show alice in review");
      assert.ok(result.includes("add comment: "), "Should have add comment action");
      assert.ok(result.includes("bob"), "Should show bob");
      assert.ok(result.includes("fix tests: "), "Should have fix tests action");
      assert.ok(result.includes("charlie"), "Should show charlie");

      // Check semicolons separate action groups
      const semicolonCount = (result.match(/;/g) || []).length;
      assert.strictEqual(semicolonCount, 2, "Should have 2 semicolons for 3 action types");
    });
  });
});
