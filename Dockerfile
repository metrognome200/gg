# Use an official Node.js runtime as a parent image
FROM node:14

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json files
COPY package*.json ./

# Install app dependencies
RUN npm install

# Bundle app source code inside the Docker image
COPY . .

# If your code refers to 'server.js', update accordingly
# Expose the port the app runs on
EXPOSE 3000

# Define environment variable
ENV NPM_CONFIG_LOGLEVEL warn

# Start the app
CMD ["node", "server.js"]  # Replace 'server.js' with the entry file of your app