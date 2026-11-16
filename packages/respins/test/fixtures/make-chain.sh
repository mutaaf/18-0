#!/bin/bash
#
# A certificate chain shaped exactly like Apple's, for the verifier's tests.
#
#   root          P-384, self-signed, CA            (stands in for Apple Root CA - G3)
#   intermediate  P-384, CA, Apple's WWDR OID       (stands in for WWDR G6)
#   leaf          P-256, Apple's receipt-signer OID (signs the JWS, ES256)
#
# Run once; the output is committed as chain.json so the tests need no openssl.
# Every key here is a test key and signs nothing but these fixtures. A second,
# unrelated root ("rogue") builds an identical chain that must be refused.
set -euo pipefail
cd "$(dirname "$0")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

chain() {
  local name="$1"
  openssl ecparam -name secp384r1 -genkey -noout -out "$WORK/$name-root.key"
  openssl req -x509 -new -key "$WORK/$name-root.key" -sha384 -days 36500 \
    -subj "/CN=17-0 Test Root ($name)/O=Test" -out "$WORK/$name-root.pem" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"

  openssl ecparam -name secp384r1 -genkey -noout -out "$WORK/$name-int.key"
  openssl req -new -key "$WORK/$name-int.key" -subj "/CN=17-0 Test WWDR ($name)/O=Test" -out "$WORK/$name-int.csr"
  printf 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n1.2.840.113635.100.6.2.1=DER:0500\n' > "$WORK/int.ext"
  openssl x509 -req -in "$WORK/$name-int.csr" -CA "$WORK/$name-root.pem" -CAkey "$WORK/$name-root.key" \
    -CAcreateserial -sha384 -days 36000 -extfile "$WORK/int.ext" -out "$WORK/$name-int.pem"

  openssl ecparam -name prime256v1 -genkey -noout -out "$WORK/$name-leaf.key"
  openssl req -new -key "$WORK/$name-leaf.key" -subj "/CN=17-0 Test StoreKit Signer ($name)/O=Test" -out "$WORK/$name-leaf.csr"
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n1.2.840.113635.100.6.11.1=DER:0500\n' > "$WORK/leaf.ext"
  openssl x509 -req -in "$WORK/$name-leaf.csr" -CA "$WORK/$name-int.pem" -CAkey "$WORK/$name-int.key" \
    -CAcreateserial -sha256 -days 35000 -extfile "$WORK/leaf.ext" -out "$WORK/$name-leaf.pem"
  openssl pkcs8 -topk8 -nocrypt -in "$WORK/$name-leaf.key" -outform DER -out "$WORK/$name-leaf.p8"

  # The same leaf key, certified without the receipt-signer OID.
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n' > "$WORK/plain.ext"
  openssl x509 -req -in "$WORK/$name-leaf.csr" -CA "$WORK/$name-int.pem" -CAkey "$WORK/$name-int.key" \
    -CAcreateserial -sha256 -days 35000 -extfile "$WORK/plain.ext" -out "$WORK/$name-plainleaf.pem"
}

der64() { openssl x509 -in "$1" -outform DER | base64 | tr -d '\n'; }

chain test
chain rogue

cat > chain.json <<JSON
{
  "root": "$(der64 "$WORK/test-root.pem")",
  "intermediate": "$(der64 "$WORK/test-int.pem")",
  "leaf": "$(der64 "$WORK/test-leaf.pem")",
  "leafWithoutOid": "$(der64 "$WORK/test-plainleaf.pem")",
  "leafKeyPkcs8": "$(base64 < "$WORK/test-leaf.p8" | tr -d '\n')",
  "rogueRoot": "$(der64 "$WORK/rogue-root.pem")",
  "rogueIntermediate": "$(der64 "$WORK/rogue-int.pem")",
  "rogueLeaf": "$(der64 "$WORK/rogue-leaf.pem")",
  "rogueLeafKeyPkcs8": "$(base64 < "$WORK/rogue-leaf.p8" | tr -d '\n')"
}
JSON
echo "wrote $(pwd)/chain.json"
