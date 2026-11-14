FROM docker.io/library/postgres:18.6-alpine@sha256:9ba53c7d41ea093baf5c1ba635ba5434c4f979880527d49bb7d9237d3193085b

# Preserve the upstream initialization and postgres UID. Its only gosu
# invocation is the startup UID switch, which Alpine's native helper supports.
RUN apk add --no-cache --upgrade krb5-libs=1.22.3-r0 libxslt=1.1.43-r4 su-exec=0.3-r0 \
    && test "$(grep -Fc 'exec gosu postgres' /usr/local/bin/docker-entrypoint.sh)" = 1 \
    && sed -i 's/exec gosu postgres/exec su-exec postgres/' /usr/local/bin/docker-entrypoint.sh \
    && unlink /usr/local/bin/gosu
