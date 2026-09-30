# Use the explicit PHP 8.4 alpine build with alpine package managers
FROM php:8.4-fpm-alpine

# Install essential system utilities and Nginx proxy wrappers
RUN apk add --no-cache \
    nginx \
    postgresql-dev \
    libpq-dev \
    bash \
    && docker-php-ext-install pdo pdo_pgsql

# Download verified stable Composer binaries straight from official roots
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Configure standard working directory
WORKDIR /var/www/html

# Copy all repository source files into the container workspace
COPY . .

# Force a clean composer installation directly inside the workspace folder room
RUN composer install --no-interaction --no-plugins --no-scripts --no-dev --prefer-dist --optimize-autoloader

# Mirror static public directories straight into your Nginx defaults
COPY nginx.conf /etc/nginx/nginx.conf

# Give folder permissions to the web server user
RUN chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache

EXPOSE 10000

CMD nginx && php-fpm
