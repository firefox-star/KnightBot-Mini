FROM node:20-slim

# Install system packages + FRESH CA certificates
# ca-certificates fix: prevents "certificate has expired" when calling external APIs
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    make \
    g++ \
    git \
    ca-certificates \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && update-ca-certificates --fresh \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Keep Node.js using the system CA store (not its bundled old certs)
ENV NODE_OPTIONS=--use-openssl-ca

WORKDIR /app

COPY package.json ./

RUN npm install --production --legacy-peer-deps --ignore-scripts && \
    npm rebuild sharp canvas

COPY . .

RUN mkdir -p tmp session database

ENV PORT=1000
EXPOSE 1000

CMD ["node", "index.js"]