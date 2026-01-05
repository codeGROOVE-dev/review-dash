// Crypto module tests
// Run with: node --test assets/crypto.test.js

import { describe, it } from "node:test";
import assert from "node:assert";

// crypto is already available in Node.js global scope (no polyfill needed)

// Import crypto module
import { Crypto } from "./crypto.js";

describe("Crypto Module", () => {
  describe("encryptToken() and decryptToken()", () => {
    it("should encrypt and decrypt a token successfully", async () => {
      const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
      const username = "testuser";
      const domain = "reviewGOOSE.dev";
      const timestamp = "1699564800000";

      // Encrypt
      const encrypted = await Crypto.encryptToken(token, username, domain, timestamp);

      // Should be base64 encoded
      assert.ok(encrypted.length > 0);
      assert.ok(typeof encrypted === "string");
      assert.notStrictEqual(encrypted, token, "Encrypted token should not match plaintext");

      // Decrypt
      const decrypted = await Crypto.decryptToken(encrypted, username, domain, timestamp);

      // Should match original
      assert.strictEqual(decrypted, token, "Decrypted token should match original");
    });

    it("should produce different ciphertext for same token (random IV)", async () => {
      const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
      const username = "testuser";
      const domain = "reviewGOOSE.dev";
      const timestamp = "1699564800000";

      const encrypted1 = await Crypto.encryptToken(token, username, domain, timestamp);
      const encrypted2 = await Crypto.encryptToken(token, username, domain, timestamp);

      // Should be different due to random IV
      assert.notStrictEqual(encrypted1, encrypted2, "Each encryption should produce different ciphertext");

      // But both should decrypt to same value
      const decrypted1 = await Crypto.decryptToken(encrypted1, username, domain, timestamp);
      const decrypted2 = await Crypto.decryptToken(encrypted2, username, domain, timestamp);
      assert.strictEqual(decrypted1, token);
      assert.strictEqual(decrypted2, token);
    });

    it("should fail to decrypt with wrong username", async () => {
      const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
      const username = "testuser";
      const domain = "reviewGOOSE.dev";
      const timestamp = "1699564800000";

      const encrypted = await Crypto.encryptToken(token, username, domain, timestamp);

      // Try to decrypt with different username - should throw
      await assert.rejects(async () => {
        await Crypto.decryptToken(encrypted, "wronguser", domain, timestamp);
      });
    });

    it("should fail to decrypt with wrong domain", async () => {
      const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
      const username = "testuser";
      const domain = "reviewGOOSE.dev";
      const timestamp = "1699564800000";

      const encrypted = await Crypto.encryptToken(token, username, domain, timestamp);

      // Try to decrypt with different domain - should throw
      await assert.rejects(async () => {
        await Crypto.decryptToken(encrypted, username, "wrong-domain.com", timestamp);
      });
    });

    it("should fail to decrypt with wrong timestamp", async () => {
      const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
      const username = "testuser";
      const domain = "reviewGOOSE.dev";
      const timestamp = "1699564800000";

      const encrypted = await Crypto.encryptToken(token, username, domain, timestamp);

      // Try to decrypt with different timestamp - should throw
      await assert.rejects(async () => {
        await Crypto.decryptToken(encrypted, username, domain, "1699564800001");
      });
    });

    it("should handle various token formats", async () => {
      const tokens = [
        "ghp_1234567890abcdefghijklmnopqrstuvwxyz", // PAT
        "gho_1234567890abcdefghijklmnopqrstuvwxyz", // OAuth
        "github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789012345678901234567890", // Fine-grained PAT
      ];
      const username = "testuser";
      const domain = "reviewGOOSE.dev";
      const timestamp = "1699564800000";

      for (const token of tokens) {
        const encrypted = await Crypto.encryptToken(token, username, domain, timestamp);
        const decrypted = await Crypto.decryptToken(encrypted, username, domain, timestamp);
        assert.strictEqual(decrypted, token, `Should handle token format: ${token.substring(0, 10)}...`);
      }
    });

    it("should require all parameters for encryption", async () => {
      await assert.rejects(
        async () => {
          await Crypto.encryptToken("token", null, "domain", "timestamp");
        },
        {
          message: /Token, username, domain, and timestamp are required/,
        }
      );

      await assert.rejects(
        async () => {
          await Crypto.encryptToken("token", "user", null, "timestamp");
        },
        {
          message: /Token, username, domain, and timestamp are required/,
        }
      );

      await assert.rejects(
        async () => {
          await Crypto.encryptToken("token", "user", "domain", null);
        },
        {
          message: /Token, username, domain, and timestamp are required/,
        }
      );
    });

    it("should require all parameters for decryption", async () => {
      await assert.rejects(
        async () => {
          await Crypto.decryptToken("encrypted", null, "domain", "timestamp");
        },
        {
          message: /Encrypted token, username, domain, and timestamp are required/,
        }
      );

      await assert.rejects(
        async () => {
          await Crypto.decryptToken("encrypted", "user", null, "timestamp");
        },
        {
          message: /Encrypted token, username, domain, and timestamp are required/,
        }
      );

      await assert.rejects(
        async () => {
          await Crypto.decryptToken("encrypted", "user", "domain", null);
        },
        {
          message: /Encrypted token, username, domain, and timestamp are required/,
        }
      );
    });

    it("should handle realistic GitHub token scenario", async () => {
      // Simulate a real login flow
      const githubToken = "ghp_vT3xR9pL2kQ8mN4bV7wC1yZ5sA6fD0hJ";
      const username = "tstromberg";
      const domain = "reviewGOOSE.dev";
      const loginTimestamp = Date.now().toString();

      // User logs in - token gets encrypted
      const encryptedToken = await Crypto.encryptToken(
        githubToken,
        username,
        domain,
        loginTimestamp
      );

      // Store in cookie (simulated)
      const cookieValue = encryptedToken;

      // Later, app needs to make API call - decrypt token
      const decryptedToken = await Crypto.decryptToken(
        cookieValue,
        username,
        domain,
        loginTimestamp
      );

      // Should be able to use decrypted token
      assert.strictEqual(decryptedToken, githubToken);
      assert.ok(decryptedToken.startsWith("ghp_"));
    });

    it("should produce different keys for different timestamps", async () => {
      const token = "ghp_test123";
      const username = "testuser";
      const domain = "reviewGOOSE.dev";

      const ts1 = "1699564800000";
      const ts2 = "1699564800001"; // 1 millisecond later

      const encrypted1 = await Crypto.encryptToken(token, username, domain, ts1);
      const encrypted2 = await Crypto.encryptToken(token, username, domain, ts2);

      // Can decrypt with correct timestamp
      const decrypted1 = await Crypto.decryptToken(encrypted1, username, domain, ts1);
      assert.strictEqual(decrypted1, token);

      // Cannot decrypt ts1's token with ts2's timestamp
      await assert.rejects(async () => {
        await Crypto.decryptToken(encrypted1, username, domain, ts2);
      });
    });
  });
});
