#!/usr/bin/env node
/**
 * Debug script to check authentication encoding
 */

import dotenv from "dotenv";

dotenv.config();

const accessKey = process.env.ASSERTTHAT_ACCESS_KEY;
const secretKey = process.env.ASSERTTHAT_SECRET_KEY;
const projectId = process.env.ASSERTTHAT_PROJECT_ID;

console.log("\n=== AssertThat Authentication Debug ===\n");

console.log("1. Environment Variables:");
console.log(`   ASSERTTHAT_PROJECT_ID: ${projectId}`);
console.log(`   ASSERTTHAT_ACCESS_KEY: ${accessKey ? accessKey.substring(0, 20) + "... (length: " + accessKey.length + ")" : "NOT SET"}`);
console.log(`   ASSERTTHAT_SECRET_KEY: ${secretKey ? secretKey.substring(0, 20) + "... (length: " + secretKey.length + ")" : "NOT SET"}`);

console.log("\n2. Basic Auth Encoding:");
const credentials = `${accessKey}:${secretKey}`;
const base64Credentials = Buffer.from(credentials).toString("base64");
console.log(`   Credentials string: ${accessKey.substring(0, 10)}...${secretKey.substring(0, 10)}...`);
console.log(`   Base64 encoded: ${base64Credentials.substring(0, 40)}...`);
console.log(`   Authorization header: Basic ${base64Credentials.substring(0, 40)}...`);

console.log("\n3. Key Format Analysis:");
console.log(`   Access Key starts with: "${accessKey.substring(0, 5)}"`);
console.log(`   Secret Key starts with: "${secretKey.substring(0, 5)}"`);
console.log(`   Access Key contains only hex chars (0-9a-f): ${/^[0-9a-f]+$/i.test(accessKey.substring(1))}`);
console.log(`   Secret Key contains only hex chars (0-9a-f): ${/^[0-9a-f]+$/i.test(secretKey.substring(1))}`);

console.log("\n4. Expected API Endpoint:");
console.log(`   GET https://bdd.assertthat.app/rest/api/1/project/${projectId}/features`);

console.log("\n=== Recommendations ===\n");

if (accessKey.startsWith("y") && secretKey.startsWith("y")) {
  console.log("⚠️  Both keys start with 'y' which is unusual.");
  console.log("   Please verify these are the correct keys from:");
  console.log("   Jira → Apps → AssertThat BDD → Settings → API Credentials");
}

console.log("\n📋 Please check in Jira AssertThat BDD settings:");
console.log("   1. Go to your Jira project");
console.log("   2. Click 'Apps' in the top menu");
console.log("   3. Find 'AssertThat BDD' in the sidebar");
console.log("   4. Look for 'API Credentials' or 'Integration' section");
console.log("   5. Copy the EXACT values shown for:");
console.log("      - Access Key (or API Key)");
console.log("      - Secret Key");
console.log("\n   Note: Some versions use 'API Token' instead of Access/Secret keys");
console.log("   If you see an 'API Token' field, copy that value and let me know.\n");

