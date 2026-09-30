FROM php:8.4-fpm-alpine

# Install required packages
RUN apk add --no-cache \
    nginx \
    postgresql-dev \
    libpq \
    bash \
    git \
    zip \
    unzip \
    dos2unix

# Install PHP extensions
RUN docker-php-ext-install pdo pdo_pgsql

# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Application directory
WORKDIR /var/www/html

# Copy Composer files first
COPY composer.json composer.lock ./

# Install dependencies WITHOUT running Laravel scripts
RUN COMPOSER_MEMORY_LIMIT=-1 composer install \
    --no-interaction \
    --no-dev \
    --prefer-dist \
    --optimize-autoloader \
    --no-scripts

# Verify Laravel framework is actually installed
RUN php -r "require 'vendor/autoload.php'; if (!class_exists('Illuminate\\Foundation\\Application')) { exit(1); } echo 'Laravel framework loaded successfully.';"

# Copy Laravel application
COPY . .

RUN test -f vendor/laravel/framework/src/Illuminate/Foundation/Application.php \
    && echo "LARAVEL FILE EXISTS" \
    || (echo "LARAVEL FILE MISSING" && exit 1)

RUN php -r "require 'vendor/autoload.php'; var_dump(class_exists('Illuminate\\\\Foundation\\\\Application'));"

RUN echo "=== LARAVEL FRAMEWORK CHECK ===" \
    && test -f /var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php \
    && echo "APPLICATION.PHP EXISTS" \
    || (echo "APPLICATION.PHP MISSING" && exit 1)

RUN php -r "require '/var/www/html/vendor/autoload.php'; echo class_exists('Illuminate\\\\Foundation\\\\Application') ? 'LARAVEL CLASS EXISTS' : 'LARAVEL CLASS MISSING';"

# Now run Laravel package discovery
RUN php artisan package:discover --ansi

# Convert Windows line endings
RUN find . -type f -not -path './.git/*' -exec dos2unix {} \;

# Create required Laravel directories
RUN mkdir -p \
    storage/framework/cache \
    storage/framework/sessions \
    storage/framework/views \
    storage/logs \
    bootstrap/cache

# Set permissions
RUN chown -R www-data:www-data \
    storage \
    bootstrap/cache

# Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 10000

CMD ["sh", "-c", "php-fpm -D && nginx -g 'daemon off;'"]