#!/usr/bin/env node

/**
 * Verify Secrets Configuration
 * 
 * Checks that all required environment variables and secrets are properly configured
 * for the AssertThat sync workflow.
 */

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';

// Load environment variables
config();

const REQUIRED_SECRETS = [
  {
    name: 'ASSERTTHAT_PROJECT_ID',
    description: 'AssertThat project ID',
    example: '10000',
    required: true,
  },
  {
    name: 'ASSERTTHAT_ACCESS_KEY',
    description: 'AssertThat API access key',
    example: 'your-access-key',
    required: true,
    alternative: 'ASSERTTHAT_TOKEN',
  },
  {
    name: 'ASSERTTHAT_SECRET_KEY',
    description: 'AssertThat API secret key',
    example: 'your-secret-key',
    required: true,
    alternative: 'ASSERTTHAT_TOKEN',
  },
  {
    name: 'ASSERTTHAT_TOKEN',
    description: 'AssertThat API token (alternative to access/secret keys)',
    example: 'your-token',
    required: false,
  },
  {
    name: 'JIRA_SERVER_URL',
    description: 'Jira server URL',
    example: 'https://your-domain.atlassian.net',
    required: true,
  },
];

const OPTIONAL_SECRETS = [
  {
    name: 'JIRA_BASE_URL',
    description: 'Jira base URL (usually same as JIRA_SERVER_URL)',
    example: 'https://your-domain.atlassian.net',
  },
  {
    name: 'JIRA_EMAIL',
    description: 'Jira account email',
    example: 'your-email@example.com',
  },
  {
    name: 'JIRA_API_TOKEN',
    description: 'Jira API token',
    example: 'your-api-token',
  },
];

function checkEnvFile() {
  const envPath = join(process.cwd(), '.env');
  const envExamplePath = join(process.cwd(), '.env.example');
  
  console.log('📁 Checking environment files...\n');
  
  if (!existsSync(envPath)) {
    console.log('⚠️  .env file not found');
    if (existsSync(envExamplePath)) {
      console.log('💡 Tip: Copy .env.example to .env and fill in your credentials');
      console.log('   Command: cp .env.example .env\n');
    }
    return false;
  }
  
  console.log('✅ .env file found\n');
  return true;
}

function checkSecret(secret) {
  const value = process.env[secret.name];
  
  if (!value) {
    if (secret.alternative) {
      const altValue = process.env[secret.alternative];
      if (altValue) {
        console.log(`✅ ${secret.name}: Using alternative ${secret.alternative}`);
        return true;
      }
    }
    
    if (secret.required) {
      console.log(`❌ ${secret.name}: MISSING (required)`);
      console.log(`   Description: ${secret.description}`);
      console.log(`   Example: ${secret.example}\n`);
      return false;
    } else {
      console.log(`⚠️  ${secret.name}: Not set (optional)`);
      return true;
    }
  }
  
  // Check if value is still the example value
  if (value === secret.example || value.includes('your-') || value.includes('example')) {
    console.log(`⚠️  ${secret.name}: Set but appears to be example value`);
    console.log(`   Current: ${value}`);
    console.log(`   Please update with actual credentials\n`);
    return false;
  }
  
  // Mask the value for security
  const maskedValue = value.length > 8 
    ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
    : '****';
  
  console.log(`✅ ${secret.name}: ${maskedValue}`);
  return true;
}

function checkOptionalSecret(secret) {
  const value = process.env[secret.name];
  
  if (!value) {
    console.log(`⚪ ${secret.name}: Not set (optional)`);
    return;
  }
  
  const maskedValue = value.length > 8 
    ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
    : '****';
  
  console.log(`✅ ${secret.name}: ${maskedValue}`);
}

function validateJiraUrl(url) {
  if (!url) return false;
  
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      console.log('   ⚠️  Warning: JIRA_SERVER_URL should use https://');
      return false;
    }
    if (!parsed.hostname.includes('atlassian.net') && !parsed.hostname.includes('jira')) {
      console.log('   ⚠️  Warning: URL doesn\'t look like a Jira instance');
    }
    return true;
  } catch (error) {
    console.log('   ❌ Invalid URL format');
    return false;
  }
}

function checkGitHubSecrets() {
  console.log('\n📋 GitHub Actions Secrets Checklist\n');
  console.log('To configure GitHub Actions secrets:');
  console.log('1. Go to: https://github.com/renatomen/obsidian-gantt/settings/secrets/actions');
  console.log('2. Add the following secrets:\n');
  
  REQUIRED_SECRETS.forEach(secret => {
    if (secret.required && !secret.alternative) {
      console.log(`   - ${secret.name}`);
    }
  });
  
  console.log('\n3. Verify secrets are configured correctly');
  console.log('4. Test with manual workflow dispatch\n');
}

async function main() {
  console.log('🔍 AssertThat Sync - Secrets Verification\n');
  console.log('='.repeat(60));
  console.log('\n');
  
  // Check .env file
  const hasEnvFile = checkEnvFile();
  
  // Check required secrets
  console.log('🔐 Checking required secrets...\n');
  let allValid = true;
  
  for (const secret of REQUIRED_SECRETS) {
    const isValid = checkSecret(secret);
    if (!isValid && secret.required) {
      allValid = false;
    }
  }
  
  // Validate Jira URL
  const jiraUrl = process.env.JIRA_SERVER_URL;
  if (jiraUrl) {
    console.log('\n🔗 Validating Jira URL...\n');
    validateJiraUrl(jiraUrl);
  }
  
  // Check optional secrets
  console.log('\n📦 Checking optional secrets...\n');
  for (const secret of OPTIONAL_SECRETS) {
    checkOptionalSecret(secret);
  }
  
  // GitHub secrets checklist
  checkGitHubSecrets();
  
  // Summary
  console.log('='.repeat(60));
  console.log('\n📊 Summary\n');
  
  if (allValid && hasEnvFile) {
    console.log('✅ All required secrets are configured!');
    console.log('\n✨ Next steps:');
    console.log('   1. Test locally: npm run sync:assertthat');
    console.log('   2. Configure GitHub Actions secrets (see checklist above)');
    console.log('   3. Test workflow: Manual dispatch from GitHub Actions tab');
    console.log('   4. Monitor first scheduled run\n');
    process.exit(0);
  } else {
    console.log('❌ Configuration incomplete');
    console.log('\n📝 Action required:');
    if (!hasEnvFile) {
      console.log('   1. Create .env file from .env.example');
    }
    console.log('   2. Fill in missing required secrets');
    console.log('   3. Update example values with actual credentials');
    console.log('   4. Run this script again to verify\n');
    console.log('💡 See docs/github-secrets-setup.md for detailed instructions\n');
    process.exit(1);
  }
}

// Execute
main().catch(error => {
  console.error('\n❌ Verification failed:', error.message);
  process.exit(1);
});

