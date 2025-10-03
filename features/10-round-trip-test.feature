# @assertthat-feature-id: Round Trip Test
Feature: Round Trip Test

    @AUTOMATED @imported-from-github @round-trip-test @imported-from-github
    # @assertthat-scenario-id: 4d0fd0887a501677043bd8c93bf7245f
    Scenario: Upload and download should preserve content - modified
        Given a feature is uploaded to AssertThat
        When the feature is downloaded back to GitHub
        Then the content should match the original scenario - modified
