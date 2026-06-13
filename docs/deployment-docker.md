# Docker Deployment

This backend can run on AWS EC2 with Docker Compose behind Nginx. Keep production secrets only in `.env.production`; do not commit that file.

## Prepare Environment

Create the production environment file from the sanitized template:

```bash
cp .env.production.example .env.production
```

Edit `.env.production` with real production values. For the Compose-managed services, keep internal Docker hostnames:

```env
REDIS_HOST=redis
RABBITMQ_URL=amqp://user:password@rabbitmq:5672
```

If you change `PORT`, also update the `api` port mapping in `docker-compose.yml` so the host and container ports match. If you change the RabbitMQ username or password in `docker-compose.yml`, update `RABBITMQ_URL` in `.env.production` to match.

## Build And Run

```bash
docker compose up -d --build
```

View logs:

```bash
docker compose logs -f api
```

After `git pull`, rebuild and restart only the API:

```bash
docker compose up -d --build api
```

## Reverse Proxy

Nginx should proxy to the loopback-bound API port:

```nginx
proxy_pass http://127.0.0.1:3000;
```

Redis and RabbitMQ are internal dependencies. Do not publish Redis publicly. RabbitMQ management, if needed, is bound only to `127.0.0.1:15672`; protect access at the server/firewall level.

## Validation

Check Compose syntax before deploying:

```bash
docker compose config
```

The Docker image installs Chromium for the prescription PDF generator and runs the compiled NestJS app with `node dist/main`.
