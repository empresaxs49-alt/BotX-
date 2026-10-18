# X$ Panel

Bot de Discord con panel web Express listo para Railway.

## Railway

- **Root Directory:** déjalo vacío / repositorio raíz.
- **Start Command:** `npm start` (ya definido en `railway.toml`).
- **Healthcheck:** `/health`.
- Node se fija en la rama 20 mediante `.nvmrc`.

## Variables requeridas

```text
DISCORD_TOKEN=...
GUILD_ID=...
WEB_USER=12
WEB_PASS=12
SESSION_SECRET=<cadena-larga-aleatoria>
```

Opcionales:

```text
SUPPORT_ROLE_ID=...
LOG_CHANNEL_ID=...
BLOCKED_WORDS=palabra1,palabra2
```

No subas `.env` ni tokens a GitHub. Tras exponer un token, rótalo desde Discord Developer Portal y actualiza `DISCORD_TOKEN` en Railway.
