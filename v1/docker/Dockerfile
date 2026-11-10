# Wayfind ONE local computer: Ubuntu userland with the tools agents reach for.
# Built once on first daemon boot (see src/computer.js), reused after.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 python3-pip \
    curl wget git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /work
CMD ["sleep", "infinity"]
