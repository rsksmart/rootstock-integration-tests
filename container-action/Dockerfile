FROM ubuntu:24.04@sha256:2e863c44b718727c860746568e1d54afd13b2fa71b160f5cd9058fc436217b30 AS builder

LABEL Description="Custom RSK node image to execute Rootstock Integration Tests"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates curl git  gnupg2 mocha wget \
    && apt clean

# -- nodeJs ---------------------------------------------------------
ENV NODE_VERSION  v20.14.0
RUN mkdir -p /usr/local/nvm
ENV NVM_DIR /usr/local/nvm

RUN  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash \
     && . $NVM_DIR/nvm.sh \
     &&  nvm install $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default

ENV NODE_PATH $NVM_DIR/$NODE_VERSION/lib/node_modules
ENV PATH $NVM_DIR/versions/node/$NODE_VERSION/bin:$PATH

# -- java ---------------------------------------------------------
ENV JAVA_VERSION 17

RUN apt-get  -y install "openjdk-$JAVA_VERSION-jdk"

ENV JAVA_HOME="/usr/lib/jvm/java-$JAVA_VERSION-openjdk-amd64"

# -- bitcoind ---------------------------------------------------------
ENV BITCOIN_VERSION 0.18.1

RUN cd /tmp \
    && wget https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}/bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz \
    && tar -xzvf bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz -C /opt \
    && mv  /opt/bitcoin-${BITCOIN_VERSION} /opt/bitcoin \
    && rm -v /opt/bitcoin/bin/test_bitcoin /opt/bitcoin/bin/bitcoin-qt \
    && ln -sv /opt/bitcoin/bin/* /usr/local/bin

# -- configure entrypoint to run RIT--------------------------------------------

WORKDIR /usr/src

COPY entrypoint.sh /usr/src/entrypoint.sh
COPY scripts/* /usr/src/

RUN chmod +x /usr/src/entrypoint.sh  \
    && chmod +x /usr/src/configure_gradle_powpeg.sh \
    && mkdir -p /usr/src/bitcoindata \
    && chmod -R 755 /usr/src/bitcoindata

# tpc signer dependencies
RUN apt-get update && \
    apt-get install -y procps libsecp256k1-dev && \
    rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["/usr/src/entrypoint.sh"]

EXPOSE 18332
