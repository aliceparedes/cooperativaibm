FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 libxml2 libcrypt1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
