# language: en
# @assertthat-feature-id: Round Trip Test
Feature: Round Trip Test

    This feature tests the complete upload-download cycle

    @AUTOMATED @imported-from-github @round-trip-test 
    # @assertthat-scenario-id: 4d0fd0887a501677043bd8c93bf7245f
    Scenario: Upload and download should preserve content - RENAMED
        
        Given a feature is uploaded to AssertThat
        When the feature is downloaded back
        Then the content should match the original

