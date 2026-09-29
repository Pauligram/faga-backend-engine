# Use the highly trusted Nginx + PHP production image wrapper
FROM richarvey/nginx-php-fpm:latest

# Set your project directory room
COPY . /var/www/html

# Define the webroot straight to Laravel's entry portal
ENV WEBROOT /var/www/html/public
ENV APP_ENV production

# Install system dependencies and optimize framework cache maps
RUN cd /var/www/html && \
    composer install --no-dev --optimize-autoloader --no-interaction && \
    php artisan config:cache && \
    php artisan route:cache

EXPOSE 8000
