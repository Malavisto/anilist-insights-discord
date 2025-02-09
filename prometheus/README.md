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
     - Drag the [dashboard JSON](https://github.com/Malavisto/anilist-randomizer-discord/prometheus/grafana_dashboard.json)
     - Import the Dashboard

**THESE INSTRUCTIONS ARE FOR A NATIVE GRAFANA INSTALL, FOR DOCKER CHANGE `http://localhost:9091` to `http://prometheus:9090`**

## Conclusion

By following the steps above, you can set up Prometheus to monitor your application and use Grafana to visualize the collected metrics. For more detailed configurations, refer to the official documentation of [Prometheus](https://prometheus.io/docs/introduction/overview/) and [Grafana](https://grafana.com/docs/grafana/latest/).
