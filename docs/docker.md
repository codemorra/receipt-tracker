# Self-hosted Docker setup

The Docker setup uses a Linux amd64 container with CPU OCR. It is tested on Linux and can also run through Docker Desktop on Windows and macOS, although these platforms are currently unverified.

Docker Engine and the Compose plugin are required. One application container runs the built frontend, backend and Python worker. Ollama runs separately.

## Start and stop

From the repository root:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f app
```

Open `http://localhost:3000`. The port is published only on the host's loopback interface. Configure an AI provider in **Settings**, then import a receipt.

The first build installs dependencies and prepares the OCR/orientation models and HPI artifacts. Later builds reuse unchanged layers. Models remain inside the image; no separate model-cache volume is needed. Normal startup uses the prepared cache.

The healthcheck uses `/health`; it checks HTTP liveness, without calling providers or starting OCR. The stop grace period is 330 seconds to allow an active OCR/provider request and worker cleanup to finish.

```bash
docker compose down
docker compose up -d
```

These commands preserve the named volumes. To rebuild after source changes, use `docker compose up --build -d` again.

## Provider addresses

The base URL entered in Settings is used by the **backend inside the application container**, not by the browser. `localhost` and `127.0.0.1` refer to that container. The application does not rewrite the URL or detect where Ollama runs.

| Ollama setup                                                     | Base URL example                    | Required connectivity                                                                                                      |
| ---------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Installed directly on the Docker host                            | `http://host.docker.internal:11434` | Ollama must listen on a host address reachable from the container.                                                         |
| Separate Docker container with a host-published port             | `http://host.docker.internal:11434` | The published port must be reachable from the application container. Use the published host port if it differs from 11434. |
| Separate container or Compose project on a shared Docker network | `http://ollama:11434`               | Both containers must join the same network; `ollama` must be the service name or network alias. Use the container port.    |
| Another machine on the local network                             | `http://192.168.1.50:11434`         | The machine must accept connections from the Docker host/container network.                                                |
| External server                                                  | `https://ollama.example.com`        | A reachable Ollama API with a trusted TLS certificate is required.                                                         |

Compose includes the Linux mapping `host.docker.internal:host-gateway`. This supports access to the host without requiring Ollama to run in Docker. Native Ollama defaults to listening only on `127.0.0.1`; configure a reachable bind address, for example `OLLAMA_HOST=0.0.0.0:11434`, and restart Ollama when needed. Firewall rules must allow the chosen connection. See the [Ollama FAQ](https://docs.ollama.com/faq#how-can-i-expose-ollama-on-my-network).

For a shared Docker network, attach the app and Ollama to an existing network using your Compose configuration or an override. The default Receipt Tracker network does not automatically connect to other Compose projects. Alternatively, use Ollama's host-published port as shown above.

The tested setup uses `http://host.docker.internal:11434` with model `qwen3.8:27b`. Install the selected model in the external Ollama instance before importing. Ollama requests originate from the backend, so browser CORS configuration is not needed for this connection. The current Ollama provider does not support custom authentication headers or endpoints requiring a Bearer token or Basic authentication.

OpenAI uses outgoing HTTPS and its API key/model are configured in Settings. Provider settings are stored in SQLite; no provider credentials are passed as build arguments or copied from a local `.env` file.

## Persistent data

Compose creates two named volumes, normally prefixed with the Compose project name:

| Volume                   | Container path | Contents                                                                                                  |
| ------------------------ | -------------- | --------------------------------------------------------------------------------------------------------- |
| `receipt-tracker-data`   | `/app/data`    | `receipt-tracker.sqlite`, receipt images in `receipts/`, temporary sessions in `scans/`, logs in `logs/`. |
| `receipt-tracker-config` | `/config`      | API-key master key in `keys/master.key`, created when the first API key is saved.                         |

Volumes survive container recreation and image rebuilds. `docker compose down -v` deliberately deletes them, including receipts and the master key. Back up both volumes together while the application is stopped to keep the database, images and key consistent. Losing the master key prevents decrypting saved API keys; an existing key is not silently replaced.

## Host directories instead of named volumes

Bind mounts make the files directly accessible in chosen host directories. For a **new instance**, the following example uses the repository's ignored `.local/` directory. Create the directories before startup, with ownership matching the runtime user (`10001:10001`):

```bash
sudo install -d -o 10001 -g 10001 -m 0755 .local/docker/data
sudo install -d -o 10001 -g 10001 -m 0700 .local/docker/config .local/docker/config/keys
```

Replace the app's two volume entries in `compose.yaml` with:

```yaml
services:
  app:
    volumes:
      - ./.local/docker/data:/app/data
      - ./.local/docker/config:/config
```

The unused top-level named-volume declarations can then be removed. Relative paths resolve from the Compose file's directory. Other absolute or relative host paths can be used with the same ownership and permissions.

The backend creates needed data subdirectories and creates `keys/master.key` with mode `0600`. The key directory must have mode `0700`; an existing key must also belong to UID 10001 and have mode `0600`. Bind mounts hide the corresponding image directories, so the image's ownership does not initialize host directories.

For an existing instance, stop the app and copy **both** volumes into the chosen host directories before changing the mounts. Preserve their contents, ownership and key permissions. Changing the mapping alone does not migrate data. Keep the original volumes until the migrated instance has been verified.
