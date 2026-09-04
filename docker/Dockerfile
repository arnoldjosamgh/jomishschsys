# Use Node 20 as base
FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Bundle app source
COPY . .

# Expose the port from config.json
EXPOSE 3005

# Command to run the app
CMD [ "node", "backend/server.js" ]
