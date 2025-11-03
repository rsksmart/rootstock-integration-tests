FROM ubuntu:24.04@sha256:66460d557b25769b102175144d538d88219c077c678a49af4afca6fbfc1b5252 AS builder

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
RUN mkdir -p /usr/local/nvm && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash \
    && . "$NVM_DIR/nvm.sh" \
    && nvm install "$NODE_VERSION" \
    && nvm alias default "$NODE_VERSION" \
    && nvm use default

ENV NVM_DIR=/usr/local/nvm
ENV NODE_PATH="${NVM_DIR}/${NODE_VERSION}/lib/node_modules"
ENV PATH="${NVM_DIR}/versions/node/${NODE_VERSION}/bin:${PATH}"

# -- java ---------------------------------------------------------
ENV JAVA_VERSION=17
ENV JAVA_HOME="/usr/lib/jvm/java-${JAVA_VERSION}-openjdk-amd64"

# -- bitcoind ---------------------------------------------------------
ENV BITCOIN_VERSION=0.18.1

WORKDIR /tmp
RUN wget "https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}/bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz" \
    && tar -xzvf "bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz" -C /opt \
    && mv "/opt/bitcoin-${BITCOIN_VERSION}" /opt/bitcoin \
    && rm -v /opt/bitcoin/bin/test_bitcoin /opt/bitcoin/bin/bitcoin-qt \
    && ln -sv /opt/bitcoin/bin/* /usr/local/bin

# Set work directory for Node.js
WORKDIR /rits

RUN mkdir /rits/bitcoin-data

# Copy Node.js dependencies and install
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install

# Copy the rest of the Node.js project
COPY . .

# Overriding .env file with docker specific values
COPY .env.docker /rits/.env

RUN chmod +x /rits/configure.sh && \
    /rits/configure.sh && \
    chmod +x /rits/runWithDockerEntrypoint.sh && \
    tar xzf /rits/tcpsigner/bin/manager-tcp.tgz -C /rits/tcpsigner/bin && \
    chmod +x /rits/tcpsigner/entrypoint.sh && \
    chmod +x /rits/tcpsigner/bin/tcpsigner && \
    chmod +x /rits/tcpsigner/bin/manager-tcp

CMD [ "npm", "run", "test-fail-fast" ]
