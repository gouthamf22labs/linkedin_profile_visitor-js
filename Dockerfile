# Use an official Node.js runtime as a base image
FROM node:20

# Install Chromium and Xvfb dependencies
RUN apt-get update -y && \
    apt-get install -y \
    chromium \
    xvfb \
    x11vnc \
    fluxbox \
    xauth \
    x11-apps \
    dbus-x11 \
    libx11-dev \
    libx11-xcb-dev \
    libxcomposite-dev \
    libxcursor-dev \
    libxi6 \
    libgconf-2-4 \
    libxrandr-dev \
    libxss-dev \
    libxtst-dev \
    fonts-liberation \
    libappindicator3-1 \
    libasound2

# Create a non-root user
RUN groupadd -r appuser && useradd -r -g appuser -G audio,video appuser \
    && mkdir -p /home/appuser/Downloads \
    && chown -R appuser:appuser /home/appuser

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the container
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy the application code to the container
COPY . .

# Change ownership of the app directory to appuser
RUN chown -R appuser:appuser /usr/src/app

# Switch to non-root user
USER appuser

# Expose the ports needed for the application
EXPOSE 8080

# Set environment variables
ENV DISPLAY=:99.0

# Specify Chromium executable path
ENV EXECUTABLE_PATH=/usr/bin/chromium

# Command to start Xvfb and the Node.js app
CMD ["sh", "-c", "pgrep Xvfb || xvfb-run --server-args='-screen 0 1920x1080x24' node index.js"]