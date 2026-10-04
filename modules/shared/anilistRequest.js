const axios = require('axios');
const metricsService = require('../observability/metrics');

// Count actual HTTP requests, including each query in a multi-query fetch.
async function anilistRequest(query, variables, endpoint, username) {
  metricsService.trackApiRequest(endpoint, 'started', username);
  try {
    const response = await axios.post(
      'https://graphql.anilist.co',
      { query, variables },
      {
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      },
    );
    if (response.data.errors?.length || !response.data.data) {
      throw new Error(response.data.errors?.[0]?.message || 'Invalid AniList response');
    }
    metricsService.trackApiRequest(endpoint, 'success', username);
    return response;
  } catch (error) {
    metricsService.trackApiRequest(endpoint, 'failure', username);
    throw error;
  }
}
module.exports = anilistRequest;
