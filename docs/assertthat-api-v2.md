# AssertThat BDD Jira Cloud REST API

## Overview

This document describes the AssertThat BDD Jira Cloud REST API endpoints used for bidirectional sync operations.
Based on official Postman collection and environment files.

**API Base URL**:
- Cloud: `https://bdd.assertthat.app`
- Server/DC: `{jiraServerUrl}/rest/assertthat/latest`

**API Version**: v1 (`/rest/api/1/...`)

## Authentication

The API supports two authentication methods:

### 1. Access Key / Secret Key (Recommended for Cloud)
```
Headers:
  Authorization: Basic {base64(accessKey:secretKey)}
```

### 2. Jira API Token (For Server/DC)
```
Headers:
  Authorization: Bearer {token}
```

## API Endpoints

### Download Features

**Endpoint**: `GET /rest/api/1/project/{projectId}/features`

**Description**: Downloads feature files from AssertThat for a specific project as a ZIP file.

**Authentication**: Basic Auth (accessKey:secretKey)

**Parameters**:
- `projectId` (path, required): Jira project ID (numeric, e.g., 10000)
- `mode` (query, optional): Filter by mode - `automated`, `manual`, or `both` (default: `automated`)
- `jql` (query, optional): JQL query to filter scenarios linked to certain issues (e.g., `project=XXX`)
- `tags` (query, optional): Tag expression to filter scenarios (e.g., `@app1 and not(@smoke)`)

**Response**: ZIP file containing feature files

**Example**:
```bash
GET https://bdd.assertthat.app/rest/api/1/project/10000/features?mode=automated&tags=@smoke
Authorization: Basic {base64(accessKey:secretKey)}
```

### Upload Feature

**Endpoint**: `POST /rest/api/1/project/{projectId}/feature`

**Description**: Uploads a single feature file to AssertThat.

**Authentication**: Basic Auth (accessKey:secretKey)

**Parameters**:
- `projectId` (path, required): Jira project ID
- `override` (query, optional): Whether to override existing feature (default: `true`)

**Request Body**: Multipart form data

**Headers**:
```
Content-Type: multipart/form-data
Authorization: Basic {base64(accessKey:secretKey)}
```

**Form Data**:
- `file`: Feature file content

**Example**:
```bash
POST https://bdd.assertthat.app/rest/api/1/project/10000/feature?override=true
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary...
Authorization: Basic {base64(accessKey:secretKey)}

------WebKitFormBoundary...
Content-Disposition: form-data; name="file"; filename="test.feature"
Content-Type: text/plain

Feature: Test Feature
  Scenario: Test Scenario
    Given a precondition
    When an action occurs
    Then verify the result
------WebKitFormBoundary...--
```

**Response**: Success/failure status

### Upload Test Results

**Endpoint**: `POST /project/{projectId}/run`

**Description**: Uploads test execution results (Cucumber JSON).

**Parameters**:
- `projectId` (path, required): Jira project ID
- `runName` (query, optional): Custom test run name
- `runId` (query, optional): Existing run ID to append results
- `jql` (query, optional): JQL to filter which tickets to update

**Request Body**: Cucumber JSON report

**Response**:
```json
{
  "runId": 123,
  "success": true,
  "scenariosProcessed": 10
}
```

## Error Handling

### HTTP Status Codes

- `200 OK`: Request successful
- `400 Bad Request`: Invalid request parameters
- `401 Unauthorized`: Authentication failed
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Project or resource not found
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error

### Error Response Format

```json
{
  "error": {
    "code": "INVALID_PROJECT",
    "message": "Project with ID 10001 not found",
    "details": {}
  }
}
```

## Rate Limiting

- Cloud: 100 requests per minute per project
- Server/DC: Configurable by administrator

## Best Practices

1. **Batch Operations**: Upload multiple features in a single request when possible
2. **Retry Logic**: Implement exponential backoff for failed requests
3. **Error Handling**: Always check response status and handle errors gracefully
4. **Tagging**: Use consistent tags for tracking feature sources (e.g., `imported`, `github`)
5. **Metadata**: Include source information and timestamps for audit trails

## Implementation Notes

Based on Maven plugin patterns:
- Features are downloaded as ZIP files
- Upload supports multipart form data
- Authentication uses Basic Auth with access/secret keys
- Project ID is numeric (e.g., 10001)
- JQL filtering follows standard Jira JQL syntax
- Tag expressions follow Cucumber tag expression syntax

## References

- AssertThat Maven Plugin: https://github.com/assertthat/assertthat-bdd-maven-plugin
- Official Documentation: https://assertthat.atlassian.net/wiki/spaces/ABTM/pages/2676097026/REST+API+for+Jira+Cloud+V2

