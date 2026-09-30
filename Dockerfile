# Use the explicit PHP 8.4 alpine build with alpine package managers
FROM php:8.4-fpm-alpine

# Install essential system utilities, Nginx proxies, and git/zip utilities required by composer
RUN apk add --no-cache \
    nginx \
    postgresql-dev \
    libpq-dev \
    bash \
    dos2unix \
    git \
    zip \
    unzip \
    && docker-php-ext-install pdo pdo_pgsql

# Download verified stable Composer binaries straight from official roots
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Configure standard working directory
WORKDIR /var/www/html

# Copy all repository source files into the container workspace
COPY . .

# CRITICAL WINDOWS FIX: Convert hidden Windows line endings (CRLF) to Linux (LF)
RUN find . -type f -not -path '*/.*' -exec dos2unix {} +

# 🚀 ULTRA-LIGHT RAM MEMORY BYPASS: Limits memory allocation and disables scripts to prevent free tier out-of-memory crashes
RUN COMPOSER_MEMORY_LIMIT=-1 composer install --no-interaction --no-plugins --no-scripts --no-dev --prefer-dist --optimize-autoloader

# Mirror static public directories straight into your Nginx defaults
COPY nginx.conf /etc/nginx/nginx.conf

# Give absolute system permissions to the web server user
RUN chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache

EXPOSE 10000

CMD nginx && php-fpm
