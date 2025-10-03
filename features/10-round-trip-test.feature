# language: en
Feature: Round Trip Test

    This feature tests the complete upload-download cycle

    @AUTOMATED @imported-from-github @round-trip-test 
    Scenario: Upload and download should preserve content
        
        Given a feature is uploaded to AssertThat
        When the feature is downloaded back
        Then the content should match the original

