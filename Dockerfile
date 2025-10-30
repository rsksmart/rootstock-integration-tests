FROM ubuntu:24.04@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30 AS builder

LABEL Description="Custom RSK node image to execute Rootstock Integration Tests"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        gnupg2 \
        mocha \
        wget \
        build-essential \
        python3 \
    && apt clean

RUN apt-get update && apt-get install -y libc6

# -- nodeJs ---------------------------------------------------------
ENV NODE_VERSION=v18.20.2
RUN mkdir -p /usr/local/nvm
ENV NVM_DIR=/usr/local/nvm

RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash \
    && . $NVM_DIR/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default

ENV NODE_PATH=$NVM_DIR/$NODE_VERSION/lib/node_modules
ENV PATH=$NVM_DIR/versions/node/$NODE_VERSION/bin:$PATH

# -- java ---------------------------------------------------------
ENV JAVA_VERSION=17

RUN apt-get update \
    && apt-get -y install "openjdk-$JAVA_VERSION-jdk"

ENV JAVA_HOME="/usr/lib/jvm/java-$JAVA_VERSION-openjdk-amd64"

# -- bitcoind ---------------------------------------------------------
ENV BITCOIN_VERSION=0.18.1

RUN cd /tmp \
    && wget https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}/bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz \
    && tar -xzvf bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz -C /opt \
    && mv /opt/bitcoin-${BITCOIN_VERSION} /opt/bitcoin \
    && rm -v /opt/bitcoin/bin/test_bitcoin /opt/bitcoin/bin/bitcoin-qt \
    && ln -sv /opt/bitcoin/bin/* /usr/local/bin

RUN apt-get update && \
    apt-get install -y procps libsecp256k1-dev && \
    rm -rf /var/lib/apt/lists/*

# Set work directory for Node.js
WORKDIR /rits

RUN mkdir /rits/bitcoin-data

# Copy Node.js dependencies and install
COPY package*.json ./
RUN npm install

# Copy the rest of the Node.js project
COPY . .

# Overriding .env file with docker specific values
COPY .env.docker /rits/.env

RUN chmod +x /rits/configure.sh
RUN /rits/configure.sh

RUN chmod +x /rits/runWithDockerEntrypoint.sh

RUN tar xzf /rits/tcpsigner/bin/manager-tcp.tgz -C /rits/tcpsigner/bin

# tcp signer dependencies
RUN chmod +x /rits/tcpsigner/entrypoint.sh \
    && chmod +x /rits/tcpsigner/bin/tcpsigner \
    && chmod +x /rits/tcpsigner/bin/manager-tcp

# Remove after debugging
RUN apt-get update && apt-get install -y iproute2 && apt-get clean
RUN apt update && apt install -y netcat-openbsd

CMD [ "npm", "run", "test-fail-fast" ]
