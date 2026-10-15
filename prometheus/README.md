# Prometheus and Grafana Setup

## Overview

This document provides instructions on setting up Prometheus for monitoring and Grafana for visualization.

## Prometheus Configuration

Prometheus uses a YAML file for configuration. An example is in this directory

## Grafana Dashboard

Grafana is used to visualize the metrics collected by Prometheus. Follow these steps to set up a Grafana dashboard:

1. **Install Grafana**: Follow the [Grafana installation guide](https://grafana.com/docs/grafana/latest/installation/).
2. **Add Prometheus Data Source**:
   - Go to Grafana and navigate to **Configuration > Data Sources**.
   - Click **Add data source** and select **Prometheus**.
   - Set the URL to `http://localhost:9091` and click **Save & Test**.
3. **Create a Dashboard**:
   - Navigate to **Home > Dashboards**.
   - Click **Import**.
   - Drag the [dashboard JSON](https://github.com/Malavisto/anilist-randomizer-discord/blob/main/prometheus/grafana_dashboard.json)
   - Import the Dashboard

**THESE INSTRUCTIONS ARE FOR A NATIVE GRAFANA INSTALL, FOR DOCKER CHANGE `http://localhost:9091` to `http://prometheus:9090`**

## Conclusion

By following the steps above, you can set up Prometheus to monitor your application and use Grafana to visualize the collected metrics. For more detailed configurations, refer to the official documentation of [Prometheus](https://prometheus.io/docs/introduction/overview/) and [Grafana](https://grafana.com/docs/grafana/latest/).

## Metric semantics

API request metrics count each HTTP request, including both queries for random selections and uncached recommendations. `started` counts attempts; `success` and `failure` record HTTP/GraphQL outcomes. Empty results can still be command failures after a successful request. Cache hits use `anilist_bot_cache_hits` separately. The dashboard cache ratio compares cache hits with executions of the four cache-enabled commands.

## API counter label migration

`anilist_api_requests_total` now has only `endpoint` and `status` labels. Removing the hashed `username` label bounds series by endpoint/outcome instead of user count. Attempt, success, and failure accounting is unchanged. The checked-in dashboard aggregates by endpoint/status and needs no query change. Historical username-labelled series remain until Prometheus retention expires; aggregate across them during the transition and remove username filters/groupings in external consumers. External dashboards have not been audited live.

The separate `anilist_user_stats` gauge retains its 12-character SHA-256 username labels. It currently has no production caller; any future use should consider bounded retention as separate work. `/readyz` checks Discord connection readiness while `/metrics` continues to export metrics regardless of that state.
