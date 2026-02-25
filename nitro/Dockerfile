FROM node:lts-alpine as builder

ARG BRANCH=main
ARG COMMIT=33ff182
ARG NITRO_REPOSITORY=https://github.com/Gurkengewuerz/nitro.git

WORKDIR /build

RUN apk add --no-cache git python3 make g++ bash
RUN git clone --branch ${BRANCH} --recurse-submodules ${NITRO_REPOSITORY} .
RUN git checkout ${COMMIT}
ADD patches/ /build/patches/
RUN if [ -d /build/patches ] && [ "$(find /build/patches -name '*.patch' -type f | wc -l)" -gt 0 ]; then \
      find /build/patches -name '*.patch' -type f -print0 | xargs -0 -I {} sh -c 'echo "Applying {}" && git apply --ignore-space-change --ignore-whitespace "{}"'; \
    else \
      echo "No Nitro patches to apply"; \
    fi
RUN npm ci --no-audit --prefer-offline
RUN npx nx build frontend



FROM nginx:alpine

COPY --from=builder /build/dist/apps/frontend/ /usr/share/nginx/html/
