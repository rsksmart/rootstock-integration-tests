FROM ubuntu:26.04@sha256:b7f48194d4d8b763a478a621cdc81c27be222ba2206ca3ca6bc42b49685f3d9e AS builder

LABEL Description="Custom RSK node image to execute Rootstock Integration Tests"

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        git \
        gnupg2 \
        iproute2 \
        libc6 \
        libsecp256k1-dev \
        mocha \
        netcat-openbsd \
        "openjdk-17-jdk" \
        procps \
        python3 \
        wget \
    && apt-get clean

# -- nodeJs ---------------------------------------------------------
ENV NODE_VERSION=v18.20.2
ENV NVM_DIR=/usr/local/nvm
RUN bash -c 'set -e; \
    mkdir -p "$NVM_DIR"; \
    curl -fsSL --proto =https -o /tmp/nvm-install.sh https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh; \
    echo "8e45fa547f428e9196a5613efad3bfa4d4608b74ca870f930090598f5af5f643  /tmp/nvm-install.sh" | sha256sum -c -; \
    bash /tmp/nvm-install.sh; \
    rm /tmp/nvm-install.sh; \
    source "$NVM_DIR/nvm.sh"; \
    nvm install "$NODE_VERSION"; \
    nvm alias default "$NODE_VERSION"; \
    nvm use default'

ENV NODE_PATH="${NVM_DIR}/versions/node/${NODE_VERSION}/lib/node_modules"
ENV PATH="${NVM_DIR}/versions/node/${NODE_VERSION}/bin:${PATH}"

# -- java ---------------------------------------------------------
ENV JAVA_VERSION=17
ENV JAVA_HOME="/usr/lib/jvm/java-${JAVA_VERSION}-openjdk-amd64"

# -- bitcoind ---------------------------------------------------------
ENV BITCOIN_VERSION=31.1

WORKDIR /tmp
RUN wget --https-only --max-redirect=0 "https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}/bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz" \
    && wget --https-only --max-redirect=0 "https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}/SHA256SUMS" \
    && sha256sum --ignore-missing -c SHA256SUMS \
    && tar -xzvf "bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz" -C /opt \
    && rm -v "bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz" SHA256SUMS \
    && mv "/opt/bitcoin-${BITCOIN_VERSION}" /opt/bitcoin \
    && rm -v /opt/bitcoin/bin/bitcoin-qt \
    && ln -sv /opt/bitcoin/bin/* /usr/local/bin

# Set work directory for Node.js
WORKDIR /rits

RUN mkdir /rits/bitcoin-data

# Copy Node.js dependencies and install
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts \
    && npm rebuild bufferutil keccak secp256k1 tiny-secp256k1 utf-8-validate

# Copy the rest of the Node.js project
COPY . .

# Overriding .env file with docker specific values
COPY .env.docker /rits/.env

RUN chmod +x /rits/configure.sh && \
    /rits/configure.sh && \
    tar xzf /rits/tcpsigner/bin/manager-tcp.tgz -C /rits/tcpsigner/bin && \
    chmod +x /rits/tcpsigner/entrypoint.sh && \
    chmod +x /rits/tcpsigner/bin/tcpsigner && \
    chmod +x /rits/tcpsigner/bin/manager-tcp

CMD [ "npm", "run", "test-fail-fast" ]
