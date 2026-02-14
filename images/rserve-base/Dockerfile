# Base image for Rserve instances.
# Build with: docker build --build-arg R_VERSION=latest -t rserve-base:latest .

ARG R_VERSION=latest
FROM r-base:${R_VERSION}

# Install system dependencies commonly needed by R packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcurl4-openssl-dev \
    libssl-dev \
    libxml2-dev \
    libfontconfig1-dev \
    libharfbuzz-dev \
    libfribidi-dev \
    libfreetype6-dev \
    libpng-dev \
    libtiff5-dev \
    libjpeg-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Rserve and pak (for fast package installation in derived images)
RUN R -e "install.packages(c('Rserve', 'pak'), repos='https://cloud.r-project.org')"

# Default Rserve port (QAP binary protocol) + HTTP/WebSocket port
EXPOSE 6311 8081

# Rserve config: enable HTTP+WebSocket transport for JS clients.
# run.Rserve() reads /etc/Rserv.conf by default.
RUN printf 'remote enable\nhttp.port 8081\n' > /etc/Rserv.conf

# Working directory for app code
WORKDIR /app

# Default command (overridden by app-specific images)
CMD ["R", "-e", "Rserve::run.Rserve(port=6311L)"]
