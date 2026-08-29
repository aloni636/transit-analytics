FROM mcr.microsoft.com/devcontainers/javascript-node:24-trixie

# Install AWS CLI v2
USER root
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip \
    && unzip -q /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/aws /tmp/awscliv2.zip

# Install Terraform (https://developer.hashicorp.com/terraform/install#linux)
RUN wget -O - https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(grep -oP '(?<=UBUNTU_CODENAME=).*' /etc/os-release || lsb_release -cs) main" | tee /etc/apt/sources.list.d/hashicorp.list \
    && apt update && apt install -y terraform

# Install just (https://just.systems/man/en/installation.html)
# Install just-lsp from its pre-built GitHub release (https://github.com/terror/just-lsp/releases)
# Sha256 file hash can be obtained from the same Github release page
RUN apt update && apt install -y just \
    && curl -fsSL "https://github.com/terror/just-lsp/releases/download/0.5.1/just-lsp-0.5.1-x86_64-unknown-linux-gnu.tar.gz" -o /tmp/just-lsp.tar.gz \
    && echo "2f515fa3df3257f93ced3a675019b95bb7f97b2c1a4ddab6948b6b58f3a678ff  /tmp/just-lsp.tar.gz" | sha256sum --check \
    && tar -xzf /tmp/just-lsp.tar.gz -C /tmp \
    && install -m 0755 /tmp/just-lsp /usr/local/bin/just-lsp \
    && rm -f /tmp/just-lsp /tmp/just-lsp.tar.gz

# AWS bash completion
RUN printf '%s\n' \
    'complete -C aws_completer aws' \
    > /etc/bash_completion.d/aws

# Install rustfs cli from its pre-built GitHub release (https://github.com/rustfs/cli/releases)
# Sha256 file hash can be obtained from the same Github release page
RUN curl -fsSL "https://github.com/rustfs/cli/releases/download/v0.1.31/rustfs-cli-linux-amd64-gnu-v0.1.31.tar.gz" -o /tmp/rustfs-cli.tar.gz \
    && echo "5fdbe89e47c3914cd14b6b1a237535e47aff257a98fa6b90697c0412e496dd18  /tmp/rustfs-cli.tar.gz" | sha256sum --check \
    && tar -xzf /tmp/rustfs-cli.tar.gz -C /tmp --one-top-level \
    && install -m 0755 /tmp/rustfs-cli/rc /usr/local/bin/rc \
    && rm -rf /tmp/rustfs-cli /tmp/rustfs-cli.tar.gz

RUN rc completions bash > /etc/bash_completion.d/rc
