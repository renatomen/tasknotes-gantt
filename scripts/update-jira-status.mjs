#!/usr/bin/env node
/**
 * OG-19/OG-20: Jira Task Status Update Script
 *
 * Updates Jira task status via REST API
 * Usage: node scripts/update-jira-status.mjs OG-19 "Done" "BDD framework implemented and tested"
 */

import https from "https";
import { URL } from "url";
import { Buffer } from "buffer";

// Jira configuration
const JIRA_BASE_URL = "https://renatomen.atlassian.net";

/**
 * Update Jira task status
 * @param {string} taskKey - Task key (e.g., "OG-19")
 * @param {string} status - New status (e.g., "Done", "In Progress")
 * @param {string} comment - Update comment
 */
async function updateJiraTaskStatus(taskKey, status, comment) {
  // Check for required environment variables
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!email || !apiToken) {
    console.error("❌ Missing Jira credentials");
    console.error(
      "Please set JIRA_EMAIL and JIRA_API_TOKEN environment variables"
    );
    console.error(
      "Get API token from: https://id.atlassian.com/manage-profile/security/api-tokens"
    );
    process.exit(1);
  }

  try {
    console.log(`🔄 Updating ${taskKey} status to "${status}"`);

    // First, get available transitions for the task
    const transitions = await getTaskTransitions(taskKey, email, apiToken);
    const targetTransition = findTransitionByName(transitions, status);

    if (!targetTransition) {
      console.error(`❌ Status "${status}" not available for ${taskKey}`);
      console.error(
        "Available transitions:",
        transitions.map((t) => t.name).join(", ")
      );
      process.exit(1);
    }

    // Execute the transition
    await executeTransition(taskKey, targetTransition.id, email, apiToken);

    // Add comment if provided
    if (comment) {
      await addComment(taskKey, comment, email, apiToken);
    }

    console.log(`✅ Successfully updated ${taskKey} to "${status}"`);
    if (comment) {
      console.log(`💬 Added comment: "${comment}"`);
    }
  } catch (error) {
    console.error(`❌ Failed to update ${taskKey}:`, error.message);
    process.exit(1);
  }
}

/**
 * Get available transitions for a task
 */
async function getTaskTransitions(taskKey, email, apiToken) {
  const url = `${JIRA_BASE_URL}/rest/api/3/issue/${taskKey}/transitions`;

  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const response = JSON.parse(data);
          resolve(response.transitions || []);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

/**
 * Find transition by name (case-insensitive)
 */
function findTransitionByName(transitions, statusName) {
  return transitions.find(
    (t) =>
      t.name.toLowerCase() === statusName.toLowerCase() ||
      t.to.name.toLowerCase() === statusName.toLowerCase()
  );
}

/**
 * Execute a transition
 */
async function executeTransition(taskKey, transitionId, email, apiToken) {
  const url = `${JIRA_BASE_URL}/rest/api/3/issue/${taskKey}/transitions`;
  const payload = JSON.stringify({
    transition: { id: transitionId },
  });

  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Add comment to task
 */
async function addComment(taskKey, comment, email, apiToken) {
  const url = `${JIRA_BASE_URL}/rest/api/3/issue/${taskKey}/comment`;
  const payload = JSON.stringify({
    body: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: comment,
            },
          ],
        },
      ],
    },
  });

  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Main execution
if (process.argv.length < 5) {
  console.error(
    "Usage: node scripts/update-jira-status.mjs <TASK_KEY> <STATUS> <COMMENT>"
  );
  console.error(
    'Example: node scripts/update-jira-status.mjs OG-19 "Done" "BDD framework implemented"'
  );
  process.exit(1);
}

const [, , taskKey, status, comment] = process.argv;
updateJiraTaskStatus(taskKey, status, comment);
