FROM node:20-alpine
WORKDIR /opt/app

# Native build tools (for better-sqlite3, sharp, etc.)
RUN apk add --no-cache python3 make g++ vips-dev

# Install deps from our own package.json (no create-strapi-app needed)
COPY package.json ./
RUN npm install --legacy-peer-deps

# Copy all project files
COPY . .

ENV NODE_ENV=production
RUN npm run build

EXPOSE 1337
CMD ["npm", "run", "start"]
