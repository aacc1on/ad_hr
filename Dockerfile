FROM node:20-slim

WORKDIR /app

# Install build tools for native modules (better-sqlite3, bcrypt)
RUN apt-get update && apt-get install -y python3 make g++ build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci
RUN npm rebuild better-sqlite3 --build-from-source
RUN npm prune --production

COPY . .

RUN mkdir -p /app/data /app/uploads /app/logs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/login', r => { if(r.statusCode!==200) throw new Error(r.statusCode) })"

CMD ["node", "server.js"]
