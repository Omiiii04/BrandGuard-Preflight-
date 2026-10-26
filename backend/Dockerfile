FROM node:20-alpine

WORKDIR /app

# Install curl/wget for healthcheck
RUN apk add --no-cache curl wget

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 4000

CMD ["npm", "start"]
