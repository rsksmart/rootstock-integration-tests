FROM ubuntu:24.04@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30 AS builder

LABEL Description="Custom RSK node image to execute Rootstock Integration Tests"

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        gnupg2 \
        libsecp256k1-dev \
        mocha \
        "openjdk-17-jdk" \
        procps \
        wget \
    && apt-get clean

# -- nodeJs ---------------------------------------------------------
ENV NODE_VERSION  v20.14.0
ENV NVM_DIR /usr/local/nvm
RUN mkdir -p /usr/local/nvm && \
    curl -fsSL --proto '=https' -o /tmp/nvm-install.sh https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh \
    && echo "8e45fa547f428e9196a5613efad3bfa4d4608b74ca870f930090598f5af5f643  /tmp/nvm-install.sh" | sha256sum -c - \
    && bash /tmp/nvm-install.sh \
    && rm /tmp/nvm-install.sh \
    && . "$NVM_DIR/nvm.sh" \
    && nvm install "$NODE_VERSION" \
    && nvm alias default "$NODE_VERSION" \
    && nvm use default
ENV NODE_PATH="${NVM_DIR}/${NODE_VERSION}/lib/node_modules"
ENV PATH="${NVM_DIR}/versions/node/${NODE_VERSION}/bin:${PATH}"

# -- java ---------------------------------------------------------
ENV JAVA_VERSION 17
ENV JAVA_HOME="/usr/lib/jvm/java-${JAVA_VERSION}-openjdk-amd64"

# -- bitcoind ---------------------------------------------------------
ENV BITCOIN_VERSION 31.1

WORKDIR /tmp
RUN wget --https-only --max-redirect=0 "https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}/bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz" \
    && wget --https-only --max-redirect=0 "https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}/SHA256SUMS" \
    && sha256sum --ignore-missing -c SHA256SUMS \
    && tar -xzvf "bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz" -C /opt \
    && rm -v "bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz" SHA256SUMS \
    && mv  "/opt/bitcoin-${BITCOIN_VERSION}" /opt/bitcoin \
    && rm -v /opt/bitcoin/bin/bitcoin-qt \
    && ln -sv /opt/bitcoin/bin/* /usr/local/bin

# -- configure entrypoint to run RIT--------------------------------------------

WORKDIR /usr/src

COPY entrypoint.sh /usr/src/entrypoint.sh
COPY scripts/* /usr/src/

RUN chmod +x /usr/src/entrypoint.sh \
    && chmod +x /usr/src/configure_gradle_powpeg.sh \
    && mkdir -p /usr/src/bitcoindata \
    && chmod -R 755 /usr/src/bitcoindata

ENTRYPOINT ["/usr/src/entrypoint.sh"]

EXPOSE 18332
