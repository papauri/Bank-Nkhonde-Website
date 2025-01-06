# Use a lightweight web server (Nginx)
FROM nginx:alpine

# Copy the build or static files to the web server directory
COPY . /usr/share/nginx/html

# Expose the default Nginx port
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
