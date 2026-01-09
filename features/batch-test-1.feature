# @assertthat-feature-id: Batch Test 1
Feature: Batch Test 1

    @AUTOMATED @batch-test @imported-from-github
    # @assertthat-scenario-id: fdd9abf0368d7835b5ea344226e51f0e
    Scenario: First batch test
        Given this is test 1
        When I run the test
        Then it should work
