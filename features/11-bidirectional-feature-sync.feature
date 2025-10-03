# language: en
Feature: Bidirectional Feature Sync

    As a developer
    I want to synchronize BDD feature files between GitHub and AssertThat
    So that I can maintain consistency across both systems and use AssertThat as the master source

    Background: 
        
        Given AssertThat BDD plugin is configured in Jira
        And valid API credentials are available
        And the GitHub repository contains feature files

    @AUTOMATED @download @sync 
    Scenario: Download features from AssertThat to GitHub
        
        Given AssertThat contains 11 feature files
        When I download features to a local directory
        Then all 11 features should be extracted successfully
        And each feature file should have valid Gherkin syntax
        And the download metadata should include source and timestamp

    @AUTOMATED @sync @upload 
    Scenario: Upload features from GitHub to AssertThat
        
        Given the GitHub repository contains feature files
        When I upload all features to AssertThat
        Then all features should be uploaded successfully
        And each feature should be tagged with @imported-from-github
        And AssertThat should be established as the master source

    @AUTOMATED @round-trip @sync 
    Scenario: Round-trip sync preserves feature content
        
        Given a feature file exists in GitHub
        When I upload the feature to AssertThat
        And I wait for AssertThat to process the upload
        And I download features from AssertThat
        Then the downloaded feature should contain the original content
        And the @imported-from-github tag should be present
        And the Gherkin syntax should remain valid

    @AUTOMATED @batch @sync 
    Scenario: Batch upload and download operations
        
        Given multiple feature files exist in GitHub
        When I upload all features in a batch operation
        And I download all features from AssertThat
        Then all uploaded features should be present in the download
        And each feature should maintain its original structure
        And all @imported-from-github tags should be preserved

    @AUTOMATED @sync @tags 
    Scenario: Preserve imported tags during sync
        
        Given a feature is uploaded from GitHub to AssertThat
        And the feature is tagged with @imported-from-github
        When I download the feature from AssertThat
        Then the @imported-from-github tag should be preserved
        And existing scenario tags should remain intact
        And no duplicate tags should be created

    @AUTOMATED @sync @transaction 
    Scenario: Transaction rollback on sync failure
        
        Given a sync transaction is started
        And a feature file is backed up
        When the feature file is modified
        And the sync operation fails
        And the transaction is rolled back
        Then the original feature file should be restored
        And the backup should be preserved for safety

    @AUTOMATED @error-handling @sync 
    Scenario: Graceful handling of download errors
        
        Given invalid API credentials are provided
        When I attempt to download features from AssertThat
        Then the download should fail gracefully
        And an error message should be returned
        And no partial files should be created

    @AUTOMATED @error-handling @sync 
    Scenario: Graceful handling of upload errors
        
        Given invalid API credentials are provided
        When I attempt to upload a feature to AssertThat
        Then the upload should fail gracefully
        And an error object should be returned
        And the failure should be logged

    @AUTOMATED @sync @validation 
    Scenario: Validate Gherkin syntax after download
        
        Given features are downloaded from AssertThat
        When I inspect the downloaded feature files
        Then each file should contain a Feature declaration
        And each file should contain at least one Scenario
        And the Gherkin syntax should be valid

    @AUTOMATED @metadata @sync 
    Scenario: Track sync metadata
        
        Given a feature is downloaded from AssertThat
        Then the download metadata should include the source system
        And the metadata should include a timestamp
        And the metadata should include the number of files extracted
        And the metadata should include the download mode

