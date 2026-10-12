FROM node:24-bookworm-slim AS node-base

# Base image for Node.js builds
FROM node-base AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Base image for backend builds
FROM node-base AS backend-dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# Build the backend TypeScript source code
FROM backend-dependencies AS backend-build
COPY backend/tsconfig.json ./
COPY backend/src/ ./src/
RUN npm run build

# Prepare the backend production dependencies
FROM backend-dependencies AS backend-production-dependencies
RUN npm prune --omit=dev

# Base image for the runtime environment
FROM python:3.12-slim-bookworm AS runtime-base
# The first supported runtime is Linux amd64 with CPU OCR.
RUN test "$(dpkg --print-architecture)" = amd64 \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates libstdc++6 libgcc-s1 libgomp1 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PADDLE_PDX_CACHE_HOME=/opt/paddlex

# Setup for the OCR environment
FROM runtime-base AS ocr-setup
ENV PIP_NO_CACHE_DIR=1
COPY python_worker/requirements.txt /tmp/worker-requirements.txt
RUN python -m venv /opt/venv \
    && python -m pip install -r /tmp/worker-requirements.txt \
    && paddleocr install_hpi_deps cpu
WORKDIR /app
COPY python_worker/*.py ./python_worker/
RUN python -m python_worker.prepare_models

# Final runtime image
FROM runtime-base AS runtime
COPY --from=node-base /usr/local/bin/node /usr/local/bin/node
COPY --from=node-base /usr/local/LICENSE /usr/local/share/doc/node/LICENSE
COPY --from=backend-build /build/backend/dist/ /app/backend/dist/
COPY --from=backend-production-dependencies /build/backend/node_modules/ /app/backend/node_modules/
COPY backend/package.json /app/backend/package.json
COPY backend/drizzle/ /app/backend/drizzle/
COPY --from=frontend-build /build/frontend/dist/ /app/frontend/dist/
COPY --from=ocr-setup /opt/venv/ /opt/venv/
COPY --from=ocr-setup /opt/paddlex/ /opt/paddlex/
COPY --from=ocr-setup /app/python_worker/ /app/python_worker/
COPY LICENSE /app/LICENSE

# Create the application user and set up necessary directories with appropriate permissions
RUN groupadd --gid 10001 receipt-tracker \
    && useradd --uid 10001 --gid 10001 --create-home \
        --home-dir /home/receipt-tracker --shell /usr/sbin/nologin receipt-tracker \
    && install -d -o 10001 -g 10001 -m 0755 \
        /app/data /app/data/receipts /app/data/scans /app/data/logs \
    && install -d -o 10001 -g 10001 -m 0700 /config /config/keys \
    && chown -R 10001:10001 /opt/paddlex

# Set environment variables for the runtime environment
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_FILE=/app/data/receipt-tracker.sqlite \
    SCANS_DIR=/app/data/scans \
    LOG_FILE=/app/data/logs/backend.log \
    SECRETS_KEY_DIR=/config/keys \
    PYTHON_EXECUTABLE=/opt/venv/bin/python

# Set the working directory for the backend application
WORKDIR /app/backend
USER 10001:10001
VOLUME ["/app/data", "/config"]
EXPOSE 3000
CMD ["node", "dist/index.js"]
