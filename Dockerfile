FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# Dependencias exactas y sin paquetes opcionales/nativos de Opus.
COPY package.json .npmrc ./
RUN npm install --omit=optional --ignore-scripts --no-audit --no-fund

# Solo se copian los archivos necesarios para ejecutar la app.
COPY index.js ./
COPY src ./src
COPY web ./web
COPY DKTl8K1.gif gif_1.gif ./

EXPOSE 8080
CMD ["npm", "start"]
