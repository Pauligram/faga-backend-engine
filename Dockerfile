# Use the explicit PHP 8.4 alpine build with alpine package managers
FROM php:8.4-fpm-alpine

# Install essential system utilities and Nginx proxy wrappers
RUN apk add --no-cache \
    nginx \
    postgresql-dev \
    libpq-dev \
    && docker-php-ext-install pdo pdo_pgsql

# Download verified stable Composer binaries straight from official roots
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Configure working directories - TYPO REPAIRED TO STANDARD PATHWAY
WORKDIR /var/www/html
COPY . .

# Run secure dependency extraction loops satisfying modern PHP parameters
RUN composer install --no-dev --optimize-autoloader --no-interaction

# Mirror static public directories straight into your Nginx defaults
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 10000

CMD nginx && php-fpm
