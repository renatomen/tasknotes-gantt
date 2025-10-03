# language: en
# @assertthat-feature-id: A random test feature for BDD
Feature: A random test feature for BDD

    Just a feature to test number stability

    Background: Check number stability
        Given I'm synchronising features
        When I delete a feature
        Then the feature file number is not assigned to another file

    @AUTOMATED 
        # @assertthat-scenario-id: c45e33370818f9bd0ffc7d38400de42d
    Scenario: A test scenarion for BDD - RENAMED
        Given I'm testing this scenario
        When I test the scenario
        Then the scenario is tested

