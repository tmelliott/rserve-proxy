# rserve-proxy

Rserve proxy for running and managing Rserve instances on a VPS.

A Docker Compose service providing:

- **Web UI** for managing Rserve instances (health checks, authentication, API tokens)
- **Nginx reverse proxy** routing requests to individual Rserve instances (e.g., `https://rserve.mydomain.com/app1` → a specific Rserve process)

## License

MIT
