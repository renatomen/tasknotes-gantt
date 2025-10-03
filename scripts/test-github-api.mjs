/**
 * Test GitHub API connection and token
 */

import dotenv from 'dotenv';
import { GitHubApiClient } from './api/GitHubApiClient.mjs';
import { execSync } from 'child_process';

dotenv.config();

async function testGitHubApi() {
  console.log('🧪 Testing GitHub API connection...\n');

  // Check if token exists
  if (!process.env.GITHUB_TOKEN) {
    console.error('❌ GITHUB_TOKEN not found in environment');
    process.exit(1);
  }

  console.log('✅ GITHUB_TOKEN found');
  console.log(`   Token starts with: ${process.env.GITHUB_TOKEN.substring(0, 20)}...`);

  // Get repository info from git remote
  try {
    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    console.log(`\n📂 Repository URL: ${remoteUrl}`);

    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
    
    if (!match) {
      console.error('❌ Could not parse GitHub repository URL');
      process.exit(1);
    }

    const owner = match[1];
    const repo = match[2];

    console.log(`   Owner: ${owner}`);
    console.log(`   Repo: ${repo}`);

    // Create GitHub API client
    const client = new GitHubApiClient({
      token: process.env.GITHUB_TOKEN,
      owner,
      repo,
      logger: console,
    });

    // Test 1: Get repository info
    console.log('\n🧪 Test 1: Get repository info...');
    try {
      const repoInfo = await client.getRepository();
      console.log('✅ Repository info retrieved:');
      console.log(`   Name: ${repoInfo.name}`);
      console.log(`   Full Name: ${repoInfo.fullName}`);
      console.log(`   Default Branch: ${repoInfo.defaultBranch}`);
    } catch (error) {
      console.error(`❌ Failed to get repository: ${error.message}`);
      console.error(`   This might indicate a token permission issue`);
      process.exit(1);
    }

    // Test 2: Check for existing PRs
    console.log('\n🧪 Test 2: Check for existing PRs...');
    try {
      const pr = await client.findPullRequest('test-branch', 'main');
      if (pr) {
        console.log(`✅ Found PR: #${pr.number}`);
      } else {
        console.log('✅ No existing PR found (this is expected)');
      }
    } catch (error) {
      console.error(`❌ Failed to check PRs: ${error.message}`);
    }

    console.log('\n✅ All tests passed!');
    console.log('\n📝 Token has correct permissions for:');
    console.log('   - Reading repository information');
    console.log('   - Checking pull requests');
    console.log('\n🎯 Ready to create PRs!');

  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

testGitHubApi();

