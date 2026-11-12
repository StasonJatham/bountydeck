#!/bin/sh
set -eu
umask 077
mkdir -p secrets
if [ -s secrets/notification_test_key.pem ] &&
  [ -s secrets/notification_test_hmac ] &&
  [ -s secrets/notification_test_smtp ] &&
  openssl x509 -in secrets/notification_test_cert.pem -checkend 0 -noout >/dev/null 2>&1 &&
  openssl x509 -in secrets/notification_test_cert.pem -noout -text | grep -q 'DNS:notify-fixture.bountydeck.test' &&
  grep -qx 'smtp://notify-fixture.bountydeck.test:2525' secrets/notification_test_smtp
then
  exit 0
fi
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 7   -subj '/CN=notify-fixture.bountydeck.test'   -addext 'subjectAltName=DNS:notify-fixture.bountydeck.test'   -keyout secrets/notification_test_key.pem   -out secrets/notification_test_cert.pem
openssl rand -hex 32 > secrets/notification_test_hmac
printf '%s\n' 'smtp://notify-fixture.bountydeck.test:2525' > secrets/notification_test_smtp
# The enclosing directory is private. Container processes need to read the files.
chmod 644 secrets/notification_test_cert.pem secrets/notification_test_smtp   secrets/notification_test_hmac secrets/notification_test_key.pem
