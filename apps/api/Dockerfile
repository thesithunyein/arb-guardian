FROM node:20-alpine AS base
WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/shared/package*.json ./packages/shared/

RUN npm install

COPY . .

RUN npm run build -w packages/shared && npm run build -w apps/api

EXPOSE 8787
CMD ["npm", "run", "start", "-w", "apps/api"]
