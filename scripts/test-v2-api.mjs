#!/usr/bin/env node

/**
 * Test AssertThat V2 API
 * 
 * This script tests the V2 API endpoints to:
 * 1. Verify the API is accessible
 * 2. Document the actual response format
 * 3. Confirm scenario IDs are available
 * 
 * Usage: node scripts/test-v2-api.mjs
 */

import dotenv from 'dotenv';
import { AssertThatApiClient } from './api/AssertThatApiClient.mjs';
import { SyncConfiguration } from './config/SyncConfiguration.mjs';

// Load environment variables
dotenv.config();

/**
 * Test V2 API scenarios endpoint
 */
async function testV2Api() {
  console.log('🧪 Testing AssertThat V2 API\n');
  console.log('=' .repeat(60));
  console.log('');

  try {
    // Load configuration
    console.log('📋 Loading configuration...\n');
    const config = new SyncConfiguration();
    config.validateConfiguration();

    // Initialize API client
    const apiClient = new AssertThatApiClient({
      projectId: config.assertThat.projectId,
      accessKey: config.assertThat.accessKey,
      secretKey: config.assertThat.secretKey,
      token: config.assertThat.token,
      jiraServerUrl: undefined, // Use AssertThat Cloud
    });

    console.log(`   Project ID: ${config.assertThat.projectId}`);
    console.log(`   Base URL: ${apiClient.baseUrl}\n`);

    // Test 1: Fetch first page of scenarios
    console.log('📥 Test 1: Fetching scenarios (page 0, size 10)...\n');
    
    const response = await apiClient.getScenarios({ page: 0, size: 10 });
    
    console.log('✅ Response received!\n');
    console.log('📊 Response structure:');
    console.log(JSON.stringify(response, null, 2));
    console.log('');

    // Analyze response structure
    console.log('🔍 Response analysis:');
    console.log(`   Type: ${typeof response}`);
    console.log(`   Keys: ${Object.keys(response).join(', ')}`);
    
    // Try to find scenarios in response
    const scenarios = response.content || response.scenarios || response.data || [];
    console.log(`   Scenarios found: ${scenarios.length}`);
    
    if (scenarios.length > 0) {
      console.log('\n📝 First scenario structure:');
      console.log(JSON.stringify(scenarios[0], null, 2));
      
      console.log('\n🔑 Scenario fields:');
      console.log(`   Keys: ${Object.keys(scenarios[0]).join(', ')}`);
      
      // Check for ID field
      const idField = scenarios[0].id || scenarios[0].scenarioId || scenarios[0].uuid;
      if (idField) {
        console.log(`   ✅ ID field found: ${idField}`);
      } else {
        console.log('   ❌ No ID field found!');
      }
    }
    
    // Test 2: Fetch all scenarios
    console.log('\n\n📥 Test 2: Fetching all scenarios...\n');
    
    const allScenarios = await apiClient.getAllScenarios();
    
    console.log(`✅ Total scenarios fetched: ${allScenarios.length}\n`);
    
    if (allScenarios.length > 0) {
      console.log('📊 Scenario summary:');
      
      // Group by feature
      const byFeature = new Map();
      for (const scenario of allScenarios) {
        const featureName = scenario.feature || scenario.featureName || 'Unknown';
        if (!byFeature.has(featureName)) {
          byFeature.set(featureName, []);
        }
        byFeature.get(featureName).push(scenario);
      }
      
      console.log(`   Features: ${byFeature.size}`);
      console.log(`   Scenarios: ${allScenarios.length}`);
      console.log('');
      
      console.log('📋 Scenarios by feature:');
      for (const [featureName, scenarios] of byFeature) {
        console.log(`   ${featureName}: ${scenarios.length} scenarios`);
      }
    }
    
    // Test 3: Fetch deleted scenarios
    console.log('\n\n📥 Test 3: Fetching deleted scenarios...\n');
    
    try {
      const deletedResponse = await apiClient.getDeletedScenarios({ page: 0, size: 10 });
      
      console.log('✅ Deleted scenarios response received!\n');
      console.log('📊 Response structure:');
      console.log(JSON.stringify(deletedResponse, null, 2));
      
      const deletedScenarios = deletedResponse.content || deletedResponse.scenarios || deletedResponse.data || [];
      console.log(`\n   Deleted scenarios found: ${deletedScenarios.length}`);
    } catch (error) {
      console.log(`⚠️  Could not fetch deleted scenarios: ${error.message}`);
    }
    
    // Summary
    console.log('\n\n' + '=' .repeat(60));
    console.log('✅ V2 API Test Complete\n');
    
    console.log('📝 Summary:');
    console.log(`   ✅ V2 API is accessible`);
    console.log(`   ✅ Scenarios endpoint works`);
    console.log(`   ✅ Found ${allScenarios.length} scenarios`);
    
    if (allScenarios.length > 0 && allScenarios[0].id) {
      console.log(`   ✅ Scenario IDs are available`);
    } else {
      console.log(`   ⚠️  Scenario ID format needs investigation`);
    }
    
    console.log('\n📋 Next steps:');
    console.log('   1. Review response format above');
    console.log('   2. Update FeatureMetadataManager.extractFromApiResponse()');
    console.log('   3. Implement ID assignment workflow');
    console.log('');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\n📋 Stack trace:');
    console.error(error.stack);
    console.error('');
    console.error('💡 Troubleshooting:');
    console.error('   1. Verify environment variables are set (.env file)');
    console.error('   2. Check ASSERTTHAT_PROJECT_ID is correct');
    console.error('   3. Verify ASSERTTHAT_ACCESS_KEY and ASSERTTHAT_SECRET_KEY');
    console.error('   4. Ensure features have been uploaded to AssertThat');
    console.error('');
    process.exit(1);
  }
}

// Run
testV2Api();

