# Use the explicit PHP 8.4 alpine build with alpine package managers
FROM php:8.4-fpm-alpine

# Install essential system utilities, Nginx proxy wrappers, and dos2unix to convert Windows files
RUN apk add --no-cache \
    nginx \
    postgresql-dev \
    libpq-dev \
    bash \
    dos2unix \
    && docker-php-ext-install pdo pdo_pgsql

# Download verified stable Composer binaries straight from official roots
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Configure standard working directory
WORKDIR /var/www/html

# Copy all repository source files into the container workspace
COPY . .

# CRITICAL WINDOWS FIX: Automatically convert any hidden Windows line endings (CRLF) to Linux (LF)
RUN find . -type f -not -path '*/.*' -exec dos2unix {} +

# Run a completely fresh composer optimized installation satisfying framework parameters
RUN composer install --no-interaction --no-plugins --no-scripts --no-dev --prefer-dist --optimize-autoloader

# Mirror static public directories straight into your Nginx defaults
COPY nginx.conf /etc/nginx/nginx.conf

# Give folder permissions to the web server user
RUN chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache

EXPOSE 10000

CMD nginx && php-fpm
