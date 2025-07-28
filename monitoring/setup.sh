#!/bin/bash

# Navigate to backend directory
cd "$(dirname "$0")/../dinebook-backend"

# Install prometheus client libraries
npm install prom-client express-prom-bundle
