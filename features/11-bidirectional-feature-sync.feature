# @assertthat-feature-id: Bidirectional Feature Sync
Feature: Bidirectional Feature Sync

    @AUTOMATED @download @sync @imported-from-github
    # @assertthat-scenario-id: 82418a286b114d37195d45f766406e3d
    Scenario: Download features from AssertThat to GitHub
        Given AssertThat contains 11 feature files
        When I download features to a local directory
        Then all 11 features should be extracted successfully
        And each feature file should have valid Gherkin syntax
        And the download metadata should include source and timestamp

    @AUTOMATED @sync @upload @imported-from-github
    # @assertthat-scenario-id: 8820867c6f6b69b61b6678c21c54472d
    Scenario: Upload features from GitHub to AssertThat
        Given the GitHub repository contains feature files
        When I upload all features to AssertThat
        Then all features should be uploaded successfully
        And each feature should be tagged with @imported-from-github
        And AssertThat should be established as the master source

    @AUTOMATED @sync @round-trip @imported-from-github
    # @assertthat-scenario-id: 21aa5f982e86f03ee8c1049cb491751e
    Scenario: Round-trip sync preserves feature content
        Given a feature file exists in GitHub
        When I upload the feature to AssertThat
        And I wait for AssertThat to process the upload
        And I download features from AssertThat
        Then the downloaded feature should contain the original content
        And the @imported-from-github tag should be present
        And the Gherkin syntax should remain valid

    @AUTOMATED @sync @batch @imported-from-github
    # @assertthat-scenario-id: 40cbe73c57b93afab09ea0d7b7ef1bdd
    Scenario: Batch upload and download operations
        Given multiple feature files exist in GitHub
        When I upload all features in a batch operation
        And I download all features from AssertThat
        Then all uploaded features should be present in the download
        And each feature should maintain its original structure
        And all @imported-from-github tags should be preserved

    @AUTOMATED @tags @sync @imported-from-github
    # @assertthat-scenario-id: 70c1c73b675c6308a3a18a1b7740e99d
    Scenario: Preserve imported tags during sync
        Given a feature is uploaded from GitHub to AssertThat
        And the feature is tagged with @imported-from-github
        When I download the feature from AssertThat
        Then the @imported-from-github tag should be preserved
        And existing scenario tags should remain intact
        And no duplicate tags should be created

    @AUTOMATED @sync @transaction @imported-from-github
    # @assertthat-scenario-id: dfcdab769e856902290916f30477fb7f
    Scenario: Transaction rollback on sync failure
        Given a sync transaction is started
        And a feature file is backed up
        When the feature file is modified
        And the sync operation fails
        And the transaction is rolled back
        Then the original feature file should be restored
        And the backup should be preserved for safety

    @AUTOMATED @sync @error-handling @imported-from-github
    # @assertthat-scenario-id: f979418aa171b52424b197ea0e962c3d
    Scenario: Graceful handling of download errors
        Given invalid API credentials are provided
        When I attempt to download features from AssertThat
        Then the download should fail gracefully
        And an error message should be returned
        And no partial files should be created

    @AUTOMATED @sync @error-handling @imported-from-github
    # @assertthat-scenario-id: 29e37fdb54f571724df5349fd6c3dfde
    Scenario: Graceful handling of upload errors
        Given invalid API credentials are provided
        When I attempt to upload a feature to AssertThat
        Then the upload should fail gracefully
        And an error object should be returned
        And the failure should be logged

    @AUTOMATED @validation @sync @imported-from-github
    # @assertthat-scenario-id: 1864b6ddc20c2c5a5bb4affcc306b6d5
    Scenario: Validate Gherkin syntax after download
        Given features are downloaded from AssertThat
        When I inspect the downloaded feature files
        Then each file should contain a Feature declaration
        And each file should contain at least one Scenario
        And the Gherkin syntax should be valid

    @AUTOMATED @sync @metadata @imported-from-github
    # @assertthat-scenario-id: b75058aabfc7965a2e7336b365bbcdba
    Scenario: Track sync metadata
        Given a feature is downloaded from AssertThat
        Then the download metadata should include the source system
        And the metadata should include a timestamp
        And the metadata should include the number of files extracted
        And the metadata should include the download mode
