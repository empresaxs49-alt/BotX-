FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# Instalación reproducible. Las dependencias opcionales SÍ se instalan:
# @snazzah/davey (cifrado DAVE, obligatorio en voz) trae su binario precompilado así.
# No hay @discordjs/opus ni nada que compile código nativo.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY index.js ./
COPY src ./src
COPY web ./web
COPY DKTl8K1.gif gif_1.gif ./

EXPOSE 8080
CMD ["npm", "start"]
